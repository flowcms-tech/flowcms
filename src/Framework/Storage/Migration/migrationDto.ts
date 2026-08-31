import { windowExpired } from "./cutover"
import { describeStoredLocation, type LocationDescription } from "./migrationDestination"
import type { MigrationProgress, ReadinessVerdict } from "./migrationCoordinator"
import type { RecoveryReport } from "./migrationRecovery"
import type { MigrationRow } from "./migrationRepository"

/**
 * WHAT THE BROWSER IS ALLOWED TO SEE.
 *
 * Built by hand, field by field, rather than by spreading a row and deleting
 * what should not be there. A denylist over a database row is one schema change
 * away from leaking: add `destinationSecretAccessKey` to the table and a
 * `{ ...row, secret: undefined }` serialiser starts shipping it the moment
 * somebody renames the column. An allowlist ships nothing it was not told to.
 *
 * THE JOB ROW HOLDS A SECRET. `destinationSecretAccessKey` is the destination's
 * key, stored so a cutover can commit it atomically with the location. It is
 * never returned in any shape — not the value, not its length, not a masked
 * form of it. The only thing this exposes is the BOOLEAN "one is configured",
 * which is what an operator needs to know whether to re-enter it.
 *
 * ENDPOINTS ARE REDACTED, not shown. An S3 endpoint can carry `user:password@`
 * in its userinfo, and this object ends up in a fetch response, a React tree
 * and probably a screenshot.
 */

export interface MigrationEntryDto {
  key: string
  kind: string
  classification: string
  state: string
  sourceSize: number | null
  destinationSize: number | null
  /** Operator-facing explanation. Written by FlowCMS, never a raw error. */
  detail: string | null
  attempts: number
}

export interface MigrationJobDto {
  id: string
  status: string
  mode: string
  /** For optimistic concurrency: every mutation echoes back the version it saw. */
  version: number

  source: LocationDescription
  destination: LocationDescription
  /** Whether a destination secret is stored. NEVER the secret itself. */
  destinationHasCredentials: boolean

  destinationTested: boolean
  inventory: {
    destinationScanComplete: boolean
    sourceScanComplete: boolean
    /** Entries recorded so far. Real progress, counted from rows. */
    recorded: number
  }

  counts: {
    byClassification: Record<string, number>
    byState: Record<string, number>
  }
  progress: MigrationProgress

  readiness: ReadinessVerdict
  extras: {
    count: number
    acknowledged: boolean
    /** True when the destination has changed since the acknowledgement. */
    acknowledgementStale: boolean
  }

  /** The single question the confirmation button should be enabled on. */
  cutoverAllowed: boolean
  cutoverBlockedBy: string[]

  lock: {
    /** A cutover is running: every storage mutation is refused right now. */
    held: boolean
    startedAt: string | null
    /** The window has run out; recovery may release it. */
    stale: boolean
  }

  failureReason: string | null
  createdAt: string
  updatedAt: string
  cutoverAt: string | null
}

export interface MigrationSnapshot {
  /** Where files live right now. */
  active: LocationDescription | null
  /**
   * How the deployment's environment differs from that, if at all.
   *
   * REPORTED, NEVER APPLIED — the message exists so an operator who edited
   * `.env` and restarted is told why nothing moved, instead of concluding that
   * FlowCMS ignored them.
   */
  drift: { message: string; candidate: LocationDescription } | null
  /** The Local destination this deployment offers, or why it offers none. */
  localDestination: { available: boolean; root?: string; reason?: string }
  job: MigrationJobDto | null
  recovery: RecoveryReport | null
  /**
   * The relocation that most recently finished, if any.
   *
   * Present so the screen can say what happened after a cutover instead of
   * falling silent — including the part that matters most, which is that the
   * previous storage was retained and is still exactly where it was.
   */
  lastCompleted: {
    source: LocationDescription
    destination: LocationDescription
    mode: string
    cutoverAt: string | null
  } | null
  /**
   * Past relocations, newest first — including the open one.
   *
   * THE AUDIT TRAIL, and it is never pruned. A completed migration records an
   * irreversible change to where an installation keeps everything it has;
   * silently discarding that after some interval is not a default anybody
   * should get without asking for it.
   */
  history: MigrationJobDto[]
}

export interface JobDtoInput {
  job: MigrationRow
  byClassification: Record<string, number>
  byState: Record<string, number>
  progress: MigrationProgress
  readiness: ReadinessVerdict
}

export function toJobDto(input: JobDtoInput): MigrationJobDto {
  const { job, byClassification, byState, progress, readiness } = input

  const extraCount = byClassification.destination_only ?? 0
  const acknowledgementStale =
    job.extrasAcknowledged && job.extrasAcknowledgedCount !== extraCount
  const extrasSettled = extraCount === 0 || (job.extrasAcknowledged && !acknowledgementStale)

  const blockedBy: string[] = []
  if (job.status !== "ready_to_cutover") {
    blockedBy.push("The destination has not been fully verified yet.")
  }
  if (!extrasSettled) {
    blockedBy.push(
      acknowledgementStale
        ? "The destination has changed since you acknowledged its extra files. Review them again."
        : "The extra files already at the destination have not been acknowledged.",
    )
  }
  blockedBy.push(...readiness.reasons)

  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    version: job.version,

    source: describeStoredLocation({
      driver: job.sourceDriver,
      endpoint: job.sourceEndpoint,
      region: job.sourceRegion,
      bucket: job.sourceBucket,
      root: job.sourceRoot,
    }),
    destination: describeStoredLocation({
      driver: job.destinationDriver,
      endpoint: job.destinationEndpoint,
      region: job.destinationRegion,
      bucket: job.destinationBucket,
      root: job.destinationRoot,
    }),
    // THE ONLY THING SAID ABOUT THE SECRET. Not its value, not its length, not
    // a masked form — only that one exists, which is what decides whether the
    // form asks for a new one.
    destinationHasCredentials: Boolean(job.destinationSecretAccessKey),

    destinationTested: job.status !== "draft",
    inventory: {
      destinationScanComplete: Boolean(job.destinationScanCompletedAt),
      sourceScanComplete: Boolean(job.sourceScanCompletedAt),
      recorded: progress.total,
    },

    counts: { byClassification, byState },
    progress,

    readiness,
    extras: {
      count: extraCount,
      acknowledged: job.extrasAcknowledged,
      acknowledgementStale,
    },

    cutoverAllowed: blockedBy.length === 0,
    cutoverBlockedBy: blockedBy,

    lock: {
      held: job.status === "cutting_over",
      startedAt: job.cutoverStartedAt ? job.cutoverStartedAt.toISOString() : null,
      stale: job.status === "cutting_over" && windowExpired(job),
    },

    failureReason: job.failureReason,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    cutoverAt: job.cutoverAt ? job.cutoverAt.toISOString() : null,
  }
}

/**
 * One entry of the report.
 *
 * The KEY IS SHOWN, deliberately: an operator resolving a conflict needs to
 * know which file, and the key is already visible in the File Manager to
 * anybody who can reach this screen. Hashes are not shown — they identify
 * nothing an operator can act on and make the payload several times larger.
 */
export function toEntryDto(row: {
  key: string
  kind: string
  classification: string
  state: string
  sourceSize: number | null
  destinationSize: number | null
  detail: string | null
  attempts: number
}): MigrationEntryDto {
  return {
    key: row.key,
    kind: row.kind,
    classification: row.classification,
    state: row.state,
    sourceSize: row.sourceSize,
    destinationSize: row.destinationSize,
    detail: row.detail,
    attempts: row.attempts,
  }
}
