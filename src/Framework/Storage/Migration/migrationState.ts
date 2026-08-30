/**
 * THE LIFECYCLE OF A STORAGE RELOCATION.
 *
 * Pure and dependency-free, so the policy can be exhausted in tests without a
 * database — and so that the one question that matters at every step,
 * "is the source still authoritative?", has an answer that is read rather than
 * inferred.
 *
 * The invariant the whole table encodes: THE SOURCE IS AUTHORITATIVE IN EVERY
 * STATE EXCEPT `completed`. A job can be abandoned, fail, or be cancelled at
 * any point before `cutting_over` and the site carries on exactly as it was,
 * because nothing outside `cutting_over` has touched the active topology.
 */

export const MIGRATION_STATUSES = [
  /** Destination configured, nothing proven yet. */
  "draft",
  /** Write/read/compare/delete succeeded against the destination. */
  "destination_tested",
  /** Enumerating source and destination. Resumable. */
  "inventorying",
  /**
   * Something must be resolved by a human before this can proceed:
   * incompatible keys, conflicting content, or — in verify-only mode — files
   * the operator said they had already migrated and had not.
   */
  "blocked",
  /** Analysis complete and clean. Nothing has been copied. */
  "ready",
  /** Transferring. Phase 4b. */
  "copying",
  /** Re-reading what was transferred and checking it. Phase 4b. */
  "verifying",
  /** Baseline verified. Awaiting the operator's explicit cutover. Phase 4b. */
  "ready_to_cutover",
  /** The brief window in which storage writes are refused. Phase 4b. */
  "cutting_over",
  /** The destination is now the active topology. */
  "completed",
  "failed",
  "cancelled",
] as const

export type MigrationStatus = (typeof MIGRATION_STATUSES)[number]

/** `copy` — FlowCMS transfers. `verify` — the operator says they already did. */
export const MIGRATION_MODES = ["copy", "verify"] as const
export type MigrationMode = (typeof MIGRATION_MODES)[number]

/** A job in one of these is finished; nothing further happens to it. */
export const TERMINAL_STATUSES: readonly MigrationStatus[] = ["completed", "failed", "cancelled"]

export function isTerminal(status: MigrationStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/**
 * Legal transitions, exhaustively.
 *
 * AN ALLOWLIST, NOT A GUARD LIST. Anything absent is refused, so a state added
 * later without an edge is unreachable rather than accidentally reachable from
 * everywhere — the same reasoning `ROUTE_POLICIES` uses for routes.
 *
 * Note what is deliberately ABSENT:
 *
 *   nothing returns from `completed`      a finished cutover is not undone by a
 *                                         state change; the destination has
 *                                         been written to since. Going back is
 *                                         a new migration in the other
 *                                         direction, which is a different job.
 *
 *   nothing returns from `cancelled`      an operator who stopped gets a fresh
 *   or `failed`                           job, so the audit trail of what was
 *                                         attempted stays intact.
 *
 *   `cutting_over` cannot go to           once the window is open the only ways
 *   `cancelled`                           out are forward or `failed`. A
 *                                         "cancel" arriving mid-switch has no
 *                                         coherent meaning: either the topology
 *                                         moved or it did not.
 */
const TRANSITIONS: Record<MigrationStatus, readonly MigrationStatus[]> = {
  // Re-testing a destination is ordinary: an operator fixes a credential and
  // tries again, which must not require discarding the job.
  draft: ["draft", "destination_tested", "failed", "cancelled"],
  destination_tested: ["draft", "inventorying", "failed", "cancelled"],
  // Inventory loops on itself: each batch is a transition that persists a
  // cursor, which is what makes it resumable.
  inventorying: ["inventorying", "blocked", "ready", "failed", "cancelled"],
  // A blocked job returns to inventory once the operator has fixed what was
  // wrong at the source — re-analysing rather than assuming.
  blocked: ["inventorying", "failed", "cancelled"],
  ready: ["copying", "verifying", "inventorying", "blocked", "failed", "cancelled"],
  copying: ["copying", "verifying", "blocked", "failed", "cancelled"],
  verifying: ["verifying", "ready_to_cutover", "blocked", "failed", "cancelled"],
  ready_to_cutover: ["cutting_over", "verifying", "blocked", "failed", "cancelled"],
  cutting_over: ["completed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
}

export function canTransition(from: MigrationStatus, to: MigrationStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function allowedTransitionsFrom(from: MigrationStatus): readonly MigrationStatus[] {
  return TRANSITIONS[from] ?? []
}

/**
 * Whether the SOURCE is still where files live.
 *
 * True everywhere except `completed`, and stated as its own function rather
 * than left implicit, because it is the question a restart has to answer and
 * the one an operator most needs the UI to answer honestly.
 *
 * `cutting_over` counts as source-authoritative: the topology has not moved
 * until the cutover transaction commits, and a crash mid-window leaves the
 * source live. That is what makes an interrupted cutover recoverable rather
 * than ambiguous.
 */
export function sourceRemainsAuthoritative(status: MigrationStatus): boolean {
  return status !== "completed"
}

/**
 * Whether a job in this state stops another from starting.
 *
 * One relocation at a time. Two concurrent jobs would each copy to their own
 * destination while the other mutated the source, and the final delta of each
 * would be computed against a baseline the other invalidated.
 */
export function blocksNewMigration(status: MigrationStatus): boolean {
  return !isTerminal(status)
}

/** What a classified entry means for readiness, per mode. */
export const ENTRY_CLASSIFICATIONS = [
  "missing",
  "matching",
  "conflicting",
  "destination_only",
  "incompatible",
] as const
export type EntryClassification = (typeof ENTRY_CLASSIFICATIONS)[number]

export const ENTRY_STATES = [
  "pending",
  "hashed",
  "copied",
  "verified",
  "blocked",
  "failed",
  "source_deleted",
] as const
export type EntryState = (typeof ENTRY_STATES)[number]

/**
 * Whether a classification stops a job reaching `ready`, GIVEN THE MODE.
 *
 * The one place the two modes genuinely differ, and the difference is the
 * operator's own claim:
 *
 *   copy mode    `missing` is the work. That is what they asked FlowCMS to do.
 *   verify mode  `missing` is the claim being false. They said the files were
 *                already there; this one is not. Copying it quietly would
 *                answer a question they did not ask and would hide that their
 *                own migration was incomplete — so it blocks instead.
 *
 * `conflicting` and `incompatible` block in BOTH modes. A destination object
 * with the same key and different content is never safe to overwrite silently,
 * and a key the destination filesystem cannot represent has no correct
 * resolution that FlowCMS may choose on its own.
 *
 * `destination_only` blocks in NEITHER. Those objects are reported, never
 * deleted, and acknowledged before cutover — they will simply become visible
 * in the File Manager afterwards.
 */
export function classificationBlocks(
  classification: EntryClassification,
  mode: MigrationMode,
): boolean {
  switch (classification) {
    case "incompatible":
    case "conflicting":
      return true
    case "missing":
      return mode === "verify"
    case "matching":
    case "destination_only":
      return false
  }
}
