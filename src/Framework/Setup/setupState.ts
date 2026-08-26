import { getSettingsRow } from "@/Framework/Settings/SettingsService"

/**
 * Whether this FlowCMS installation has ever been initialized.
 *
 * THE AUTHORITY IS `settings.setupCompletedAt`, AND NOTHING ELSE.
 *
 * The tempting test is "are there any users?" and it is wrong in a way that
 * matters: deleting every account — an operator tidying up, a botched restore,
 * a cascade nobody predicted — would reopen public first-run setup on a live
 * production site, and the next visitor holding the deployment token could
 * claim ownership of it. A durable marker cannot be un-set by anything the
 * product does.
 *
 * The user count is not gone; it moved to where it belongs. It is a
 * PRECONDITION OF THE COMPLETION MUTATION — "create the first owner" is
 * meaningless when one exists — and it is checked inside the transaction, in
 * `completeSetup.ts`, alongside the marker. It is never consulted here, because
 * status is a different question from eligibility.
 *
 * Existing installations are handled by migration 0004, which writes the marker
 * for any database that already had a user when it upgraded. After that
 * migration the heuristic has served its one purpose and is never used again.
 */

export type SetupStatus =
  /** Never initialized. First-run setup is open. */
  | { state: "incomplete" }
  /** Initialized. First-run setup is closed, permanently. */
  | { state: "complete"; completedAt: Date | null }
  /** The question could not be answered. NOT the same as "incomplete". */
  | { state: "blocked"; reason: "database" }

/** The one field of the settings row this module reads. */
export interface SetupMarkerSource {
  setupCompletedAt: Date | number | null
}

/**
 * The classification, as a pure function of the stored row.
 *
 * Separated from the query so the policy can be tested exhaustively without a
 * database — the same split `buildReadinessReport` uses, and for the same
 * reason.
 *
 * A null row means a fresh install that has never written settings. That is
 * "incomplete", not "blocked": the absence of a row is a definite answer.
 */
export function classifySetupState(row: SetupMarkerSource | null | undefined): SetupStatus {
  const marker = row?.setupCompletedAt ?? null
  if (marker === null) return { state: "incomplete" }

  const completedAt = marker instanceof Date ? marker : new Date(Number(marker))
  return {
    state: "complete",
    // A stored value that will not parse is still a completed installation.
    // Refusing to call it complete because the timestamp is malformed would
    // reopen setup over a cosmetic defect, which is the one outcome this
    // module exists to prevent.
    completedAt: Number.isNaN(completedAt.getTime()) ? null : completedAt,
  }
}

/**
 * The installation's setup status.
 *
 * READS THROUGH THE SETTINGS CACHE, which is correct for display and would be
 * wrong for the mutation. A cached "incomplete" is at worst a form that renders
 * for a few seconds after another replica finished; the completion transaction
 * re-reads authoritative state and never trusts what it was handed, so a stale
 * cache cannot produce a second owner. See `completeSetup.ts`.
 *
 * DOES NOT LET A DATABASE OUTAGE LOOK LIKE A FRESH INSTALL. If the row cannot
 * be read, this returns `blocked` rather than `incomplete`. The difference is
 * the whole reason the type has three states: answering "incomplete" during an
 * outage would redirect a live production site to a first-run form, and offer
 * ownership of it to anyone watching.
 */
export async function getSetupStatus(): Promise<SetupStatus> {
  try {
    return classifySetupState(await getSettingsRow())
  } catch {
    // The error text is deliberately dropped rather than returned: this value
    // reaches an unauthenticated page, and driver errors quote connection
    // strings. The database's own health is reported by /api/ready.
    return { state: "blocked", reason: "database" }
  }
}

/**
 * Convenience for the routing decisions that must fail SAFE.
 *
 * `blocked` counts as complete here, deliberately. Every caller uses this to
 * decide whether to expose the setup surface, and exposing first-run setup
 * because the database was briefly unreachable is strictly worse than hiding it
 * from an operator who can retry.
 */
export async function isSetupClosed(): Promise<boolean> {
  const status = await getSetupStatus()
  return status.state !== "incomplete"
}
