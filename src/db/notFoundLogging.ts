import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db } from "./client"
import { notFoundLog } from "@/db/tables"
import { CacheService } from "@/Framework/Redis/CacheService"

/**
 * The write side of the 404 monitor.
 *
 * Shared by the public logging route (`POST /api/public/404-log`, called from
 * the client not-found page) and the blog post page's not-found branch, which
 * calls in directly — a server component fetching this app's own HTTP route
 * would be a pointless round trip.
 *
 * The design constraint is that 404 traffic is mostly scanners. Writing a row
 * per hit would mean a database write per scanner request and a table that
 * grows without bound while burying the handful of paths that are actually
 * broken links. So: ignore-list first, then one row per path with a counter,
 * then a rate limit, then a cap.
 */

/**
 * Scanner probes, dropped before they ever reach the database.
 *
 * These are not broken links and no redirect will ever be created for them.
 * Left in, they would outnumber real entries by orders of magnitude and make
 * the screen useless — which is the same as not having it.
 */
const SCANNER_PATTERNS: RegExp[] = [
  /wp-/i, // wp-admin, wp-login.php, wp-content, wp-includes
  /xmlrpc/i,
  /\.(php\d?|asp|aspx|jsp|cgi|pl|sh|sql|bak|old|swp|ini|yml|yaml|log)(\?|$|\/)/i,
  /\/\.env/i,
  /\/\.git/i,
  /\/\.aws/i,
  /\/\.ssh/i,
  /\/\.vscode/i,
  /\/\.well-known\//i, // probes; the real ones are served before routing
  /\/vendor\//i,
  /\/cgi-bin\//i,
  /(php|my)admin/i,
  /\/(administrator|typo3|joomla|drupal|magento|laravel|telescope|actuator)\b/i,
  /autodiscover/i,
  /\/(backup|dump|db|database)(\.|\/|$)/i,
  /\/(config|credentials|secrets?)(\.|\/|$)/i,
  /\.(zip|tar|gz|rar|7z)(\?|$)/i,
  /\/ds_store|\.ds_store/i,
]

export function shouldIgnoreNotFoundPath(path: string): boolean {
  return SCANNER_PATTERNS.some((pattern) => pattern.test(path))
}

/** Longer than any URL this site generates. A 2 000-character path is either
 *  an injection attempt or a bug, and either way it is not a broken link. */
const MAX_PATH_LENGTH = 300

/**
 * Reduces a raw request path to the storable form, or null if it is not
 * something this site could ever have served.
 *
 * The query string is stripped deliberately: `?utm_source=…` on a broken link
 * would otherwise fan one broken URL out into dozens of rows that all need the
 * same single redirect.
 */
export function normalizeNotFoundPath(raw: string): string | null {
  if (!raw) return null

  let path = raw.trim()

  // An absolute URL can arrive from a client reporting window.location; keep
  // only its path, and only if it is ours to keep. Anything unparseable that
  // still looks absolute is rejected rather than guessed at.
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname
    } catch {
      return null
    }
  }

  path = path.split(/[?#]/)[0]
  if (!path.startsWith("/")) return null
  if (path.includes("..") || path.includes("\0")) return null
  if (path.length > MAX_PATH_LENGTH) return null

  // Trailing slash normalised away so /blog/foo and /blog/foo/ are one row and
  // one redirect, not two.
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1)

  return path
}

/**
 * One database write per path per window.
 *
 * This is a flood guard, not accounting: a bot hammering the same bad URL
 * should cost one write, not ten thousand. It degrades to no limiting at all
 * when Redis is absent, which is correct — the limit is an optimization and
 * the table cap below is what actually bounds growth.
 */
const RATE_LIMIT_WINDOW_SECONDS = 30

/** Hard cap on the table. Past this, the rows worth keeping are the ones with
 *  repeat hits — those are the live broken links. */
const MAX_ROWS = 5000
const PRUNE_CHECK_INTERVAL_SECONDS = 300

async function pruneIfOversized(): Promise<void> {
  // Counting on every insert would put a full table scan on the 404 path.
  // Once every few minutes is enough for a cap measured in thousands.
  const checkedRecently = await CacheService.getJson<boolean>("not-found-log:pruned")
  if (checkedRecently) return
  await CacheService.setJson("not-found-log:pruned", true, PRUNE_CHECK_INTERVAL_SECONDS)

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(notFoundLog)

  const excess = Number(total) - MAX_ROWS
  if (excess <= 0) return

  // Single-hit rows only, oldest first. A path with repeat hits is a live
  // broken link and is the entire point of the table; a one-off is almost
  // always a typo someone made once.
  const doomed = await db
    .select({ id: notFoundLog.id })
    .from(notFoundLog)
    .where(and(eq(notFoundLog.hits, 1), sql`${notFoundLog.resolvedAt} is null`))
    .orderBy(asc(notFoundLog.lastSeenAt))
    .limit(excess)

  if (doomed.length === 0) return
  await db.delete(notFoundLog).where(
    inArray(
      notFoundLog.id,
      doomed.map((row) => row.id)
    )
  )
}

/**
 * Records one 404. Never throws — a logging failure must never turn a 404 into
 * a 500, and the caller is on the not-found path already.
 */
export async function recordNotFound(rawPath: string, referrer?: string | null): Promise<void> {
  try {
    const path = normalizeNotFoundPath(rawPath)
    if (!path) return
    if (shouldIgnoreNotFoundPath(path)) return

    const limiterKey = `not-found-log:seen:${path}`
    if (await CacheService.getJson<boolean>(limiterKey)) return
    await CacheService.setJson(limiterKey, true, RATE_LIMIT_WINDOW_SECONDS)

    const now = new Date()
    const lastReferrer = referrer?.trim().slice(0, MAX_PATH_LENGTH) || null

    await db
      .insert(notFoundLog)
      .values({ path, hits: 1, lastReferrer, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: notFoundLog.path,
        set: {
          hits: sql`${notFoundLog.hits} + 1`,
          lastSeenAt: now,
          // Only overwritten when we actually have one, so a direct hit
          // doesn't erase the referrer that told you where the bad link lives.
          ...(lastReferrer ? { lastReferrer } : {}),
        },
      })

    await pruneIfOversized()
  } catch {
    // Deliberately silent. This is best-effort telemetry attached to an error
    // page; there is nothing useful a caller could do with a failure.
  }
}

/**
 * Marks a logged path as fixed. Called when a redirect is created for it.
 *
 * The row is kept rather than deleted: the whole question after fixing a 404
 * is "did the hits stop", and a deleted row cannot answer it.
 */
export async function markNotFoundResolved(path: string): Promise<void> {
  try {
    const normalized = normalizeNotFoundPath(path)
    if (!normalized) return
    await db
      .update(notFoundLog)
      .set({ resolvedAt: new Date() })
      .where(eq(notFoundLog.path, normalized))
  } catch {
    // Same reasoning as recordNotFound — never fail the redirect write over
    // a bookkeeping update.
  }
}
