import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { upsert } from "@/db/writes"
import { settings } from "@/db/tables"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { getSettingsRow, invalidateSettingsCache } from "./SettingsService"
import { DEFAULT_THEME_SLUG, getInstalledTheme } from "@/Themes/registry"

/**
 * Reading and writing which theme is active.
 *
 * The two halves are deliberately asymmetric, and that asymmetry is the whole
 * design:
 *
 *   THE WRITE PATH IS STRICT. `setActiveTheme` refuses anything that is not a
 *   well-formed slug naming a theme this build contains and can render. New bad
 *   state should never be created.
 *
 *   THE READ PATH IS RESILIENT. `getActiveThemeSlug` returns whatever is
 *   stored, untouched and unjudged, because a database written by an older
 *   version — or by an operator with a SQL client — can contain anything, and
 *   the public site still has to render. Classifying it is the resolver's job.
 *
 * Lives in Settings rather than in `src/Themes/` so that theme code never
 * imports the database client. The resolver calls in here; nothing here renders
 * anything.
 */

/** Same rule the manifest validator applies. Duplicated as a constant rather
 *  than imported so this module does not depend on Zod to reject a string. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isWellFormedThemeSlug(value: string): boolean {
  return value.length > 0 && value.length <= 64 && SLUG.test(value)
}

/**
 * The persisted selection, exactly as stored.
 *
 * Null means no selection: either no settings row exists yet (a fresh install,
 * where the public site must still render) or the column was never set. Both
 * mean "the default theme", and the resolver treats them identically.
 *
 * Reads through the Settings cache, so this costs no query on the hot path and
 * needs no cache of its own. It also means activation becomes visible as soon
 * as the settings cache is invalidated — which `setActiveTheme` does — with no
 * process restart.
 *
 * DOES NOT CATCH. If the database is unreachable this throws, and it must: a
 * database outage is not a theme selection, and quietly answering "default"
 * would turn an infrastructure failure into a silent configuration change.
 */
export async function getActiveThemeSlug(): Promise<string | null> {
  const row = await getSettingsRow()
  const stored = row?.activeTheme?.trim()
  return stored ? stored : null
}

export type SetActiveThemeResult =
  | { ok: true; slug: string }
  | { ok: false; error: string }

/**
 * Activate a theme.
 *
 * The domain-level setter Phase 6.4's activation route will call. It exists so
 * that activation cannot go through the generic settings update path, which
 * would happily persist any string an admin form sent and create precisely the
 * broken state the resolver has to tolerate.
 *
 * Validates in the order an operator would want to be told about: shape, then
 * existence in this build, then whether it can actually render.
 *
 * Returns a result rather than throwing. A rejected activation is an expected
 * outcome with a message a human reads, not an exceptional one.
 */
export async function setActiveTheme(slug: string): Promise<SetActiveThemeResult> {
  const candidate = slug.trim()

  if (!isWellFormedThemeSlug(candidate)) {
    // The rejected value is NOT echoed back. It arrives from outside and ends
    // up in an admin page and a log line; a slug that failed the format check
    // is by definition not something to render.
    return { ok: false, error: "Theme slug must be lowercase letters, numbers and hyphens." }
  }

  const installed = getInstalledTheme(candidate)
  if (!installed) {
    return {
      ok: false,
      error: `No theme "${candidate}" is installed in this build. Themes are installed by building them in, not by activating them.`,
    }
  }

  if (!installed.available) {
    const detail =
      installed.reason === "incompatible"
        ? "it does not support this version of FlowCMS"
        : "its theme package is invalid"
    return { ok: false, error: `Theme "${candidate}" cannot be activated because ${detail}.` }
  }

  // Upsert, because a fresh install has no settings row and activation must
  // not require somebody to have visited the settings screen first.
  //
  // Through `upsert()` from @/db/writes rather than `onConflictDoUpdate`
  // directly: MySQL and MariaDB have no ON CONFLICT clause at all, so the
  // direct form is a SQLite/PostgreSQL-only write that would fail on two of the
  // four supported engines. `tests/architecture/dialectIsolation.test.ts`
  // catches exactly this, and did.
  await upsert(
    settings,
    { id: SETTINGS_SINGLETON_ID, activeTheme: candidate, updatedAt: new Date() },
    { target: settings.id, set: { activeTheme: candidate, updatedAt: new Date() } },
  )

  // The settings row is the only thing cached, so one invalidation is what
  // makes the new theme visible on the next request — no restart, no
  // theme-specific cache to keep in step.
  await invalidateSettingsCache()

  return { ok: true, slug: candidate }
}

/**
 * Clear the selection, returning the site to the default theme.
 *
 * Writes null rather than the literal "default" so that "no choice made" keeps
 * one representation. See the column comment in `src/db/schema/settings.ts`.
 */
export async function clearActiveTheme(): Promise<void> {
  await db
    .update(settings)
    .set({ activeTheme: null, updatedAt: new Date() })
    .where(eq(settings.id, SETTINGS_SINGLETON_ID))
  await invalidateSettingsCache()
}

export { DEFAULT_THEME_SLUG }
