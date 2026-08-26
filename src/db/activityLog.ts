import { and, desc, eq, gte, lte, like, lt, or, sql, type SQL } from "drizzle-orm"
import { db } from "./client"
import { activityLog } from "@/db/tables"
import { ACTIVITY_RETENTION_DAYS } from "./schema/activityLog"
import type { ActivityAction, ActivityEntityType } from "@/Framework/Activity/activityTypes"

/**
 * The write and read sides of the activity log.
 *
 * `recordActivity` is called from every route that changes something. It is
 * fire-and-forget by design — see the try/catch — because the audit entry is
 * always less important than the operation it describes, and a panel that
 * refuses to publish a post because a logging insert failed would be a worse
 * product than one with a gap in its history.
 */

/** The slice of `session.user` a caller passes through. Typed loosely so a
 *  route can hand over `session.user` directly without reshaping it. */
export interface ActivityActor {
  id?: string | null
  name?: string | null
  email?: string | null
}

export interface RecordActivityInput {
  actor: ActivityActor | null | undefined
  action: ActivityAction
  entityType: ActivityEntityType
  /** Null when the subject has no id of its own (site settings) or no longer
   *  has one. Never a foreign key — see the schema comment. */
  entityId?: string | null
  /** The name/title/path as it was at this moment. Snapshotted, not looked up
   *  at render: a renamed entity's old entries must keep the old name. */
  entityLabel: string
  summary?: string | null
  metadata?: Record<string, unknown> | null
}

/** Long enough for a post title plus context, short enough that one row can
 *  never blow up the list screen. */
const MAX_LABEL_LENGTH = 200
const MAX_SUMMARY_LENGTH = 500

/**
 * Writes one entry. Never throws.
 *
 * Deliberately not awaited-and-checked by callers either: every call site
 * treats it as a side effect of a write that has already succeeded.
 */
export async function recordActivity(input: RecordActivityInput): Promise<void> {
  try {
    await db.insert(activityLog).values({
      actorId: input.actor?.id ?? null,
      // Email as the fallback, "Unknown" as the last resort. A row that cannot
      // name its actor is still worth keeping — "someone unpublished this at
      // 3pm" answers more than no row at all.
      actorName: (input.actor?.name || input.actor?.email || "Unknown").slice(0, MAX_LABEL_LENGTH),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      entityLabel: (input.entityLabel || "—").slice(0, MAX_LABEL_LENGTH),
      summary: input.summary ? input.summary.slice(0, MAX_SUMMARY_LENGTH) : null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    })
  } catch {
    // Deliberately silent, for the reason in the module comment: the operation
    // this describes has already happened and cannot be rolled back from here.
  }
}

/**
 * Human labels for the fields a diff can mention, keyed by column name. The
 * maps live in `Framework/Activity/fieldLabels.ts`.
 */
export type FieldLabels = Record<string, string>

function isSameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const left = a instanceof Date ? a.getTime() : a
    const right = b instanceof Date ? b.getTime() : b
    return left === right
  }
  if (typeof a === "object" && a !== null) return JSON.stringify(a) === JSON.stringify(b)
  // Loose on null/undefined/"" only: a PATCH that sends "" to clear a null
  // column has changed nothing the reader would recognise as a change.
  const emptyA = a === null || a === undefined || a === ""
  const emptyB = b === null || b === undefined || b === ""
  if (emptyA && emptyB) return true
  return a === b
}

/**
 * Which of `labels`' fields actually changed, as human labels.
 *
 * Only keys present in `after` are considered, so a PATCH that left a field out
 * never reads as a change to it. Returns `[]` when nothing meaningful moved —
 * callers use that to write "Saved with no changes" rather than an empty
 * "Changed: " sentence.
 */
export function changedFieldLabels(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: FieldLabels
): string[] {
  const changed: string[] = []
  for (const [key, label] of Object.entries(labels)) {
    if (!(key in after)) continue
    if (isSameValue(before[key], after[key])) continue
    changed.push(label)
  }
  return changed
}

/** "Changed title, meta description" — or a fallback, because an entry that
 *  says nothing is noise. */
export function summariseChanges(changed: string[], fallback = "Saved with no field changes"): string {
  if (changed.length === 0) return fallback
  return `Changed ${changed.join(", ")}`
}

// -- Read side ----------------------------------------------------------------

export interface ActivityFilters {
  action?: ActivityAction
  entityType?: ActivityEntityType
  entityId?: string
  actorId?: string
  /** Matches the entity label, the summary, or the actor's name — the three
   *  things someone actually remembers when they come looking. */
  search?: string
  from?: Date
  to?: Date
  page?: number
  perPage?: number
}

export const ACTIVITY_PER_PAGE = 25

function buildWhere(filters: ActivityFilters): SQL | undefined {
  const conditions: SQL[] = []

  if (filters.action) conditions.push(eq(activityLog.action, filters.action))
  if (filters.entityType) conditions.push(eq(activityLog.entityType, filters.entityType))
  if (filters.entityId) conditions.push(eq(activityLog.entityId, filters.entityId))
  if (filters.actorId) conditions.push(eq(activityLog.actorId, filters.actorId))
  if (filters.from) conditions.push(gte(activityLog.createdAt, filters.from))
  if (filters.to) conditions.push(lte(activityLog.createdAt, filters.to))

  if (filters.search) {
    const term = `%${filters.search}%`
    const match = or(
      like(activityLog.entityLabel, term),
      like(activityLog.summary, term),
      like(activityLog.actorName, term)
    )
    if (match) conditions.push(match)
  }

  if (conditions.length === 0) return undefined
  return conditions.length === 1 ? conditions[0] : and(...conditions)
}

export type ActivityRow = typeof activityLog.$inferSelect

/** One page of entries plus the total, so the table can render pagination. */
export async function listActivity(
  filters: ActivityFilters
): Promise<{ rows: ActivityRow[]; total: number }> {
  const page = Math.max(1, filters.page ?? 1)
  const perPage = Math.min(100, Math.max(1, filters.perPage ?? ACTIVITY_PER_PAGE))
  const where = buildWhere(filters)

  const [[{ total }], rows] = await Promise.all([
    db.select({ total: sql<number>`count(*)` }).from(activityLog).where(where),
    db
      .select()
      .from(activityLog)
      .where(where)
      .orderBy(desc(activityLog.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage),
  ])

  return { rows, total: Number(total) }
}

/** Distinct actors that appear in the log, for the "who" filter. Read from the
 *  log itself rather than from `users` so the dropdown still offers a deleted
 *  account whose entries are still there. */
export async function listActivityActors(): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .selectDistinct({ id: activityLog.actorId, name: activityLog.actorName })
    .from(activityLog)
    .orderBy(activityLog.actorName)

  const seen = new Set<string>()
  const actors: { id: string; name: string }[] = []
  for (const row of rows) {
    // Entries whose account was deleted have a null actorId and cannot be
    // filtered by id, so they are left out of the dropdown rather than offered
    // as an option that returns nothing.
    if (!row.id || seen.has(row.id)) continue
    seen.add(row.id)
    actors.push({ id: row.id, name: row.name })
  }
  return actors
}

/**
 * Deletes entries past the retention window. Never throws.
 *
 * Called from the log's own GET — there is no cron, and hanging this off a
 * public request path (as `publishDueScheduledPosts` must be) would put a
 * delete on visitor traffic for a purely administrative table.
 */
export async function pruneExpiredActivity(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    await db.delete(activityLog).where(lt(activityLog.createdAt, cutoff))
  } catch {
    // Bookkeeping. A failed prune must not blank the screen it runs behind.
  }
}
