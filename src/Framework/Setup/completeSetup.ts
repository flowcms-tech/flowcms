import { and, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/db/client"
import { affectedRowCount, isUniqueViolation } from "@/db/writes"
import { settings, users } from "@/db/tables"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { normalizeEmail } from "@/Framework/Auth/identity"
import { BCRYPT_COST } from "@/Framework/Auth/password"
import bcrypt from "bcryptjs"
import { invalidateSettingsCache } from "@/Framework/Settings/SettingsService"
import {
  EMAIL_SHAPE,
  MAX_OWNER_EMAIL_LENGTH,
  MAX_SITE_NAME_LENGTH,
  MAX_TAGLINE_LENGTH,
  MIN_OWNER_PASSWORD_LENGTH,
} from "./ownerRules"

/**
 * The one mutation that turns a deployed FlowCMS into an installed one.
 *
 * Everything about this function is shaped by a single requirement: **there is
 * exactly one first owner, ever.** Two operators clicking "Complete Setup" at
 * the same moment with different email addresses must produce one account and
 * one deterministic loser — and the unique index on `user.email` cannot decide
 * that, because the two emails differ. The singleton marker decides it.
 *
 * WHY THE CLAIM IS A CONDITIONAL UPDATE
 *
 * The obvious shape — read the marker, see null, write the marker — is a lost
 * update under PostgreSQL's READ COMMITTED: both transactions read null, both
 * write, both create an owner. The claim is therefore
 *
 *     UPDATE settings SET setupCompletedAt = ?
 *      WHERE id = 'global' AND setupCompletedAt IS NULL
 *
 * and the verdict is the affected-row count. A second writer blocks on the row
 * lock, and when it proceeds it re-evaluates its own WHERE clause against the
 * committed row, which no longer matches. That behaviour is standard on all
 * four engines; `affectedRowCount` in `src/db/writes.ts` normalises the three
 * ways the drivers report it.
 *
 * On a genuinely fresh install there is no settings row at all, and then the
 * INSERT itself is the guard: the primary key `'global'` can only be claimed
 * once, and the loser gets a constraint violation that is translated to the
 * same conflict result. This is the same mechanism `bootstrap-owner.mjs`
 * already relies on for `user.email`.
 *
 * WHY THE STATUS CACHE IS NOT TRUSTED
 *
 * `getSetupStatus()` reads through the Settings cache, which is right for
 * rendering a page and wrong for this. Everything below re-reads authoritative
 * persisted state inside the transaction. A replica holding a five-minute-stale
 * "incomplete" cannot create a second owner, because its claim will match zero
 * rows.
 *
 * WHAT IS NOT IN THE TRANSACTION
 *
 * The activity entry. `recordActivity` is fire-and-forget and must never be
 * able to fail the operation it describes — that rule holds across every write
 * in this codebase and there is no reason for setup to be the exception. It is
 * written after commit, by the caller.
 */

// Re-exported so callers of the domain get the bounds from the domain. The
// values themselves live in `./ownerRules`, which imports nothing: the client
// form's Zod schema needs them too, and importing them from here dragged
// `@/db/client` — and therefore `postgres`, `mysql2` and `@libsql/client` —
// into the browser bundle, which fails `next build` on `net`/`dns`/`fs`.
export {
  MIN_OWNER_PASSWORD_LENGTH,
  MAX_OWNER_EMAIL_LENGTH,
  MAX_SITE_NAME_LENGTH,
  MAX_TAGLINE_LENGTH,
} from "./ownerRules"

export interface CompleteSetupInput {
  siteName: string
  tagline?: string | null
  ownerEmail: string
  ownerPassword: string
  ownerName?: string | null
}

export type CompleteSetupResult =
  | { ok: true; ownerId: string; ownerEmail: string; completedAt: Date }
  /** Someone else got there first, or this installation was already initialized. */
  | { ok: false; reason: "already_completed" }
  /** The input did not satisfy the first-owner rules. Never echoes the password. */
  | { ok: false; reason: "invalid"; messages: string[] }

/**
 * Validate the first-owner rules.
 *
 * Deliberately duplicated from the Zod schema the form uses, and deliberately
 * NOT skipped because the route already parsed: this function is the domain,
 * and `create-flowcms` or any other caller must get the same answer without
 * having to know which Zod schema to reach for. The Zod schema imports the
 * constants above so the two cannot disagree about the numbers.
 */
export function validateFirstOwner(input: CompleteSetupInput): string[] {
  const messages: string[] = []

  const siteName = input.siteName?.trim() ?? ""
  if (!siteName) messages.push("Site name is required")
  else if (siteName.length > MAX_SITE_NAME_LENGTH) {
    messages.push(`Site name must be at most ${MAX_SITE_NAME_LENGTH} characters`)
  }

  const tagline = input.tagline?.trim() ?? ""
  if (tagline.length > MAX_TAGLINE_LENGTH) {
    messages.push(`Tagline must be at most ${MAX_TAGLINE_LENGTH} characters`)
  }

  const email = normalizeEmail(input.ownerEmail ?? "")
  if (!email) messages.push("Email is required")
  // The same shape `scripts/bootstrap-owner.mjs` applies, from the shared
  // rules module rather than written out twice.
  else if (!EMAIL_SHAPE.test(email)) messages.push("Invalid email")
  else if (email.length > MAX_OWNER_EMAIL_LENGTH) {
    messages.push(`Email must be at most ${MAX_OWNER_EMAIL_LENGTH} characters`)
  }

  const password = input.ownerPassword ?? ""
  if (password.length < MIN_OWNER_PASSWORD_LENGTH) {
    // The LENGTH is reported. The password never is, in any branch, ever.
    messages.push(`Password must be at least ${MIN_OWNER_PASSWORD_LENGTH} characters`)
  }

  return messages
}

/**
 * Complete first-run setup, atomically.
 *
 * `now` is injectable so a test can prove the marker it wrote is the marker it
 * reads back, without depending on clock resolution.
 */
export async function completeSetup(
  input: CompleteSetupInput,
  now: Date = new Date(),
): Promise<CompleteSetupResult> {
  const messages = validateFirstOwner(input)
  if (messages.length > 0) return { ok: false, reason: "invalid", messages }

  const siteName = input.siteName.trim()
  const tagline = input.tagline?.trim() || null
  const ownerEmail = normalizeEmail(input.ownerEmail)
  const ownerName = input.ownerName?.trim() || null

  // Hashing is deliberately OUTSIDE the transaction. bcrypt at cost 12 takes
  // hundreds of milliseconds, and holding a write lock on the settings
  // singleton for that long would turn every concurrent attempt into a queue
  // behind work that is about to be discarded anyway.
  const passwordHash = await bcrypt.hash(input.ownerPassword, BCRYPT_COST)
  const ownerId = crypto.randomUUID()

  let result: CompleteSetupResult
  try {
    result = await db.transaction(async (tx) => {
      // AUTHORITATIVE READ — straight past the settings cache.
      const [existing] = await tx
        .select({ id: settings.id, setupCompletedAt: settings.setupCompletedAt })
        .from(settings)
        .where(eq(settings.id, SETTINGS_SINGLETON_ID))
        .limit(1)

      if (existing?.setupCompletedAt) {
        return { ok: false, reason: "already_completed" } as const
      }

      // "Create the FIRST owner" is meaningless when one exists. This is the
      // same rule scripts/bootstrap-owner.mjs enforces, and it is the reason
      // the marker's absence alone is not sufficient authorisation: a database
      // restored from a backup taken before the marker existed would otherwise
      // let someone claim ownership alongside the real owner.
      const [{ count }] = await tx.select({ count: sql<number>`count(*)` }).from(users)
      if (Number(count) > 0) {
        return { ok: false, reason: "already_completed" } as const
      }

      if (!existing) {
        // Fresh install: the primary key is the race guard. A concurrent
        // attempt that also found no row will violate it and land in the catch
        // below as `already_completed`.
        await tx.insert(settings).values({
          id: SETTINGS_SINGLETON_ID,
          siteName,
          tagline,
          setupCompletedAt: now,
          updatedAt: now,
        })
      } else {
        // A settings row already exists with no marker. Claim it conditionally;
        // the affected-row count is the verdict.
        const claimed = await tx
          .update(settings)
          .set({ siteName, tagline, setupCompletedAt: now, updatedAt: now })
          .where(and(eq(settings.id, SETTINGS_SINGLETON_ID), isNull(settings.setupCompletedAt)))

        if (affectedRowCount(claimed) !== 1) {
          return { ok: false, reason: "already_completed" } as const
        }
      }

      await tx.insert(users).values({
        id: ownerId,
        name: ownerName,
        email: ownerEmail,
        passwordHash,
        isActive: true,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      })

      return { ok: true, ownerId, ownerEmail, completedAt: now } as const
    })
  } catch (error) {
    // A unique violation here means a concurrent attempt committed first —
    // either on `settings.id` or on `user.email`. Both are the same outcome
    // from the caller's point of view, and both leave the database in the state
    // the winner created, because the transaction rolled back whole.
    if (isUniqueViolation(error)) return { ok: false, reason: "already_completed" }
    throw error
  }

  if (result.ok) {
    // The settings row is the only thing cached, so one invalidation is what
    // closes /setup on THIS replica immediately. Other replicas close within
    // the cache TTL for display purposes, and cannot complete setup at any
    // point in between because the mutation re-reads authoritative state.
    await invalidateSettingsCache()
  }

  return result
}
