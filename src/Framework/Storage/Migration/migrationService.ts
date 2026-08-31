import { advanceInventory, DEFAULT_INVENTORY_BATCH } from "./inventory"
import { advanceMigration, assessReadiness, readProgress } from "./migrationCoordinator"
import { caseSensitivityBlocker, type KnownCaseSensitivity } from "./compatibility"
import { destinationConfigOf } from "./cutover"
import {
  buildDestinationConfig,
  describeLocation,
  describeStoredLocation,
  MigrationDestinationError,
  resolveLocalDestinationCandidate,
  type DestinationInput,
} from "./migrationDestination"
import { toEntryDto, toJobDto, type MigrationSnapshot } from "./migrationDto"
import { reconcileStorageRecovery, type RecoveryReport } from "./migrationRecovery"
import {
  MigrationAlreadyActiveError,
  MigrationTransitionError,
  type MigrationRepository,
  type MigrationRow,
} from "./migrationRepository"
import { performCutover, type CutoverResult } from "./performCutover"
import type { MigrationMode, MigrationStatus } from "./migrationState"
import type { DestinationTestResult } from "./destinationTest"
import type { CaseProbeResult } from "./compatibility"
import { describeTopologyDrift } from "../activeStorage"
import { storageLocationId, type ResolvedStorageConfig } from "../storageConfig"
import type { StorageDriver } from "../StorageDriver"

/**
 * THE ONE ENTRY POINT FOR EVERYTHING A STORAGE MIGRATION DOES.
 *
 * Phases 4a, 4b1 and 4b2 built a complete engine and left it as a set of parts:
 * a classifier, a compatibility scanner, a destination probe, an execution
 * engine, a coordinator, a delta, a commit transaction and a recovery verdict.
 * Every one is correct. What was missing was anything that assembled them in
 * the right order, which meant the order lived nowhere — and an order that
 * lives nowhere gets re-derived, slightly differently, by each caller.
 *
 * So this module is the only thing routes and pages talk to. It owns:
 *
 *   WHICH DRIVER IS WHICH. The source is the LIVE topology, read from the
 *   active snapshot and checked against what the job recorded; the destination
 *   is built from the job row. Nothing else in FlowCMS constructs a driver for
 *   a location that is not active.
 *
 *   WHAT MAY HAPPEN NEXT. Every mutation goes through the state machine, and
 *   an illegal one is a deterministic conflict rather than a partial effect.
 *
 *   WHEN RECOVERY RUNS. Reading the state reconciles an interrupted cutover
 *   first, so the answer describes the installation as it is rather than as it
 *   was when a process died.
 *
 * IT IS INJECTABLE END TO END. Every dependency that touches the settings row,
 * the environment or an object store is a parameter, so the orchestration can
 * be driven against a real temporary database and real temporary stores in a
 * test — which is the only way the ordering properties are worth anything.
 */

export type MigrationErrorStatus = 400 | 404 | 409 | 422 | 503

/** A refusal a route can turn into a response without interpreting it. */
export class MigrationServiceError extends Error {
  readonly status: MigrationErrorStatus
  readonly reasons: string[]

  constructor(status: MigrationErrorStatus, reasons: string[]) {
    super(reasons[0] ?? "The migration could not be updated.")
    this.name = "MigrationServiceError"
    this.status = status
    this.reasons = reasons
  }
}

export interface MigrationServiceDeps {
  repository: MigrationRepository
  /** Where files live right now — the persisted snapshot, not the environment. */
  activeConfig: () => Promise<ResolvedStorageConfig>
  /** What the deployment's environment describes, for drift reporting only. */
  environmentConfig: () => Promise<ResolvedStorageConfig | null>
  createDriver: (config: ResolvedStorageConfig) => StorageDriver
  testDestination: (config: ResolvedStorageConfig) => Promise<DestinationTestResult>
  probeCaseSensitivity: (root: string) => Promise<CaseProbeResult>
  acquireLock: (migrationId: string, fromStatus: string) => Promise<boolean>
  commit: (job: MigrationRow, destination: ResolvedStorageConfig) => Promise<void>
  clearCredentials: (migrationId: string) => Promise<void>
  invalidateCaches: () => Promise<void>
  env: NodeJS.ProcessEnv
}

/** Caps, so a client cannot ask for unbounded work. */
export const MAX_BATCH_SIZE = 500
export const MAX_PAGE_SIZE = 200
export const MAX_CONCURRENCY = 8
/** How many past relocations the storage screen lists. */
export const HISTORY_LIMIT = 20

export function createMigrationService(deps: MigrationServiceDeps) {
  const { repository } = deps

  // ---- reading ------------------------------------------------------------

  /**
   * Everything the storage screen needs, in one read.
   *
   * RECOVERY RUNS FIRST. A job left in `cutting_over` by a dead process is also
   * the write lock, so reporting it without trying to resolve it would describe
   * an installation whose uploads are refused and offer no way out.
   */
  async function snapshot(): Promise<MigrationSnapshot> {
    const recovery = await reconcileStorageRecovery({
      repository,
      activeLocationId,
      clearCredentials: deps.clearCredentials,
      invalidateCaches: deps.invalidateCaches,
    }).catch(() => null)

    const active = await deps.activeConfig().catch(() => null)
    const candidate = await deps.environmentConfig().catch(() => null)

    const drift =
      active && candidate && storageLocationId(active) !== storageLocationId(candidate)
        ? {
            message: describeTopologyDrift(active, candidate) ?? "",
            candidate: describeLocation(candidate),
          }
        : null

    const localCandidate = resolveLocalDestinationCandidate(deps.env)

    return {
      active: active ? describeLocation(active) : null,
      drift,
      localDestination: localCandidate.available
        ? { available: true, root: localCandidate.root }
        : { available: false, reason: localCandidate.reason },
      job: await describeActiveJob(),
      recovery: recovery && recovery.outcome !== "idle" ? recovery : null,
      lastCompleted: await describeLastCompleted(),
      history: await history(HISTORY_LIMIT),
    }
  }

  /**
   * Past relocations, newest first, read-only.
   *
   * Bounded rather than paginated: the list is short by nature — an
   * installation relocates its storage a handful of times in its life — and a
   * paginated history screen for three rows would be ceremony. The full
   * per-entry report of any one of them is still reachable through `entries`.
   */
  async function history(limit = HISTORY_LIMIT) {
    const rows = await repository.listRecent(clamp(limit, 1, MAX_PAGE_SIZE))
    return Promise.all(rows.map((row) => jobDtoFor(row)))
  }

  /** One migration, open or finished. Read-only by construction. */
  async function describeJob(migrationId: string) {
    return jobDtoFor(await requireReadableJob(migrationId))
  }

  async function describeLastCompleted() {
    const job = await repository.findLastCompleted()
    if (!job) return null
    return {
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
      mode: job.mode,
      cutoverAt: job.cutoverAt ? job.cutoverAt.toISOString() : null,
    }
  }

  async function describeActiveJob() {
    const job = await repository.findActive()
    if (!job) return null
    return jobDtoFor(job)
  }

  async function jobDtoFor(job: MigrationRow) {
    const [byClassification, byState, progress, readiness] = await Promise.all([
      repository.countByClassification(job.id),
      repository.countByState(job.id),
      readProgress(job.id, repository),
      assessReadiness(job.id, repository, job.mode as MigrationMode),
    ])
    return toJobDto({ job, byClassification, byState, progress, readiness })
  }

  /** A page of the entry report. Bounded at the database. */
  async function entries(
    migrationId: string,
    filter: { classification?: string; state?: string },
    page: { limit: number; offset: number },
  ) {
    // READABLE, not open. The per-key report of a finished migration is the
    // most useful part of its audit trail.
    const job = await requireReadableJob(migrationId)
    const limit = clamp(page.limit, 1, MAX_PAGE_SIZE)
    const offset = Math.max(0, Math.floor(page.offset))

    const [rows, total] = await Promise.all([
      repository.listEntries(job.id, filter, { limit, offset }),
      repository.countEntriesMatching(job.id, filter),
    ])

    return { entries: rows.map(toEntryDto), total, limit, offset }
  }

  // ---- creating -----------------------------------------------------------

  /**
   * Opens a migration to a candidate destination.
   *
   * THE SAME-LOCATION CHECK IS THE INTERESTING PART. `storageLocationId()`
   * already exists to tell a credential rotation from a relocation — it is
   * built from endpoint, region and bucket, and deliberately excludes
   * credentials — so this asks it rather than inventing a second identity rule
   * that could disagree with the topology guard's.
   */
  async function create(input: { mode: string; destination: DestinationInput }) {
    const mode = normaliseMode(input.mode)

    const existing = await repository.findActive()
    if (existing) {
      throw new MigrationServiceError(409, [
        "A storage migration is already in progress. Finish or cancel it before starting another.",
      ])
    }

    let destination: ResolvedStorageConfig
    try {
      destination = buildDestinationConfig(input.destination, deps.env)
    } catch (error) {
      if (error instanceof MigrationDestinationError) {
        throw new MigrationServiceError(422, [error.message])
      }
      throw error
    }

    const active = await deps.activeConfig()
    if (storageLocationId(active) === storageLocationId(destination)) {
      throw new MigrationServiceError(422, [
        "That is the storage location this site already uses, so there is nothing to migrate. " +
          "If you are changing an access key or secret for the same bucket, use the credentials " +
          "section on this page — rotating a credential moves no files.",
      ])
    }

    try {
      const job = await repository.create({
        mode,
        source: {
          driver: active.driver,
          locationId: storageLocationId(active),
          endpoint: active.driver === "s3" ? (active.endpoint ?? null) : null,
          region: active.driver === "s3" ? (active.region ?? null) : null,
          bucket: active.driver === "s3" ? active.bucket : null,
          root: active.driver === "local" ? active.root : null,
        },
        destination: {
          driver: destination.driver,
          locationId: storageLocationId(destination),
          endpoint: destination.driver === "s3" ? (destination.endpoint ?? null) : null,
          region: destination.driver === "s3" ? (destination.region ?? null) : null,
          bucket: destination.driver === "s3" ? destination.bucket : null,
          root: destination.driver === "local" ? destination.root : null,
        },
        destinationAccessKeyId: destination.driver === "s3" ? destination.accessKeyId : null,
        destinationSecretAccessKey: destination.driver === "s3" ? destination.secretAccessKey : null,
      })
      return jobDtoFor(job)
    } catch (error) {
      if (error instanceof MigrationAlreadyActiveError) {
        throw new MigrationServiceError(409, [error.message])
      }
      throw error
    }
  }

  // ---- proving the destination -------------------------------------------

  /**
   * Write, read back, compare, delete — and, for a filesystem, find out how it
   * treats case.
   *
   * THE CASE PROBE HAPPENS HERE AND IS PERSISTED. Deriving it later, per batch,
   * would let a restart reinterpret keys already classified under the other
   * assumption. An indeterminate answer FAILS CLOSED: if the destination is
   * really case-insensitive, treating it as sensitive lets `Photo.png` and
   * `photo.png` through as two keys and the second silently overwrites the
   * first while the migration reports success.
   */
  async function testDestination(migrationId: string) {
    const job = await requireOpenJob(migrationId)
    if (job.status !== "draft" && job.status !== "destination_tested") {
      throw new MigrationServiceError(409, [
        "The destination can only be tested before the inventory has run.",
      ])
    }

    const destination = destinationConfigOf(job)
    const result = await deps.testDestination(destination)

    if (!result.ok) {
      await transition(job, "draft", { failureReason: result.message ?? null })
      return { ok: false, failure: result.failure, message: result.message }
    }

    let caseSensitive: boolean | null = null
    if (destination.driver === "local") {
      const probe = await deps.probeCaseSensitivity(destination.root)
      const blocker = caseSensitivityBlocker(probe)
      if (blocker) {
        await transition(job, "draft", { failureReason: blocker })
        return { ok: false, failure: "path_unavailable" as const, message: blocker }
      }
      caseSensitive = probe.sensitivity === "sensitive"
    }

    await transition(job, "destination_tested", {
      destinationCaseSensitive: caseSensitive,
      failureReason: null,
    })

    return { ok: true }
  }

  // ---- inventory ----------------------------------------------------------

  /** One bounded inventory batch. Resumable from the database alone. */
  async function runInventoryBatch(migrationId: string, options: { batchSize?: number } = {}) {
    const job = await requireOpenJob(migrationId)

    // Every state from which a FRESH analysis makes sense — including
    // `ready_to_cutover`, because an operator who has just fixed something at
    // either end must be able to re-check without discarding the work already
    // copied. Re-analysing reads both stores and writes to neither.
    const startsFreshPass =
      job.status === "destination_tested" ||
      job.status === "blocked" ||
      job.status === "ready" ||
      job.status === "ready_to_cutover"

    if (startsFreshPass) {
      // A FRESH PASS. The cursors are cleared and the run is stamped, so
      // anything the new scan does not see can be recognised as left over from
      // the last one. The extras acknowledgement is dropped with them: it
      // described a destination listing that is about to be replaced.
      await transition(job, "inventorying", {
        sourceCursor: null,
        sourceScanCompletedAt: null,
        destinationCursor: null,
        destinationScanCompletedAt: null,
        // A NEW GENERATION, so everything this pass records is stamped with it
        // and anything left from the last one is recognisable as stale — with
        // no dependence on any node's clock.
        inventoryGeneration: job.inventoryGeneration + 1,
        extrasAcknowledged: false,
        extrasAcknowledgedAt: null,
        extrasAcknowledgedCount: 0,
        failureReason: null,
      })
    } else if (job.status !== "inventorying") {
      throw new MigrationServiceError(409, [
        `An inventory cannot start while this migration is ${job.status}.`,
      ])
    }

    const current = (await repository.findById(job.id))!
    const { source, destination } = await drivers(current)

    const result = await advanceInventory(
      current,
      {
        repository,
        source,
        destination,
        destinationCaseSensitivity: caseSensitivityOf(current),
      },
      { batchSize: clamp(options.batchSize ?? DEFAULT_INVENTORY_BATCH, 1, MAX_BATCH_SIZE) },
    )

    if (result.complete) {
      const readiness = await assessReadiness(job.id, repository, current.mode as MigrationMode)
      const settled = (await repository.findById(job.id))!
      // BLOCKED IS ABOUT THE ANALYSIS, NOT ABOUT UNFINISHED WORK. Entries that
      // simply have not been processed yet are the work; a conflict or an
      // unrepresentable key is a decision somebody has to make.
      const analysisBlocked =
        (await repository.countEntriesMatching(job.id, { classification: "conflicting" })) > 0 ||
        (await repository.countEntriesMatching(job.id, { classification: "incompatible" })) > 0
      await transition(settled, analysisBlocked ? "blocked" : "ready", {
        totalEntries: await repository.countEntries(job.id),
        failureReason: analysisBlocked ? readiness.reasons[0] ?? null : null,
      })
    }

    return { ...result, job: await describeActiveJob() }
  }

  // ---- transfer / verification -------------------------------------------

  /**
   * One bounded batch of transfer (copy mode) or checking (verify-only mode).
   *
   * The stale-baseline sweep runs FIRST, and it is what lets a job converge.
   * An entry the engine marked `source_changed` still carries the hash of the
   * bytes that were inventoried, so re-copying it would compare against that
   * old hash and mark it changed again, forever. Clearing the baseline makes
   * the fresh read the new baseline, which is the only thing "the source moved"
   * can honestly mean.
   */
  async function runTransferBatch(
    migrationId: string,
    options: { batchSize?: number; concurrency?: number } = {},
  ) {
    const job = await requireOpenJob(migrationId)
    const mode = job.mode as MigrationMode

    if (job.status === "ready") {
      await transition(job, mode === "copy" ? "copying" : "verifying", { failureReason: null })
    } else if (job.status !== "copying" && job.status !== "verifying") {
      throw new MigrationServiceError(409, [
        `This migration cannot transfer while it is ${job.status}.`,
      ])
    }

    const current = (await repository.findById(job.id))!
    const { source, destination } = await drivers(current)

    await sweepStaleBaseline(current, destination)

    const result = await advanceMigration(
      job.id,
      { repository, source, destination, mode },
      {
        batchSize: clamp(options.batchSize ?? 50, 1, MAX_BATCH_SIZE),
        concurrency: clamp(options.concurrency ?? 4, 1, MAX_CONCURRENCY),
      },
    )

    if (result.exhausted) {
      const readiness = await assessReadiness(job.id, repository, mode)
      const settled = (await repository.findById(job.id))!

      if (readiness.ready) {
        if (settled.status === "copying") {
          const verifying = await transition(settled, "verifying", { failureReason: null })
          await transition(verifying, "ready_to_cutover", {
            baselineCompletedAt: new Date(),
            failureReason: null,
          })
        } else {
          await transition(settled, "ready_to_cutover", {
            baselineCompletedAt: new Date(),
            failureReason: null,
          })
        }
      } else if ((await repository.countEntriesMatching(job.id, { state: "blocked" })) > 0) {
        await transition(settled, "blocked", { failureReason: readiness.reasons[0] ?? null })
      }
    }

    return { ...result, job: await describeActiveJob() }
  }

  /**
   * Resolves entries whose recorded baseline no longer describes the source.
   *
   * `source_changed` -> the baseline is cleared and the entry re-queued, so the
   *                     next pass reads the source afresh and adopts what it
   *                     finds. Without this the entry can never leave that
   *                     state, and `assessReadiness` refuses to cut over on it.
   *
   * `source_deleted` -> the source object is gone. If THIS migration wrote the
   *                     destination copy, that copy is removed and the row is
   *                     settled. If it did not, the object belongs to somebody
   *                     else: it is left exactly where it is and reclassified
   *                     as a destination-only extra, which is what it now is.
   */
  async function sweepStaleBaseline(job: MigrationRow, destination: StorageDriver) {
    const changed = await repository.listEntries(
      job.id,
      { state: "source_changed" },
      { limit: MAX_BATCH_SIZE, offset: 0 },
    )
    for (const row of changed) {
      await repository.saveOutcome(job.id, row.key, {
        state: "pending",
        createdByMigration: row.createdByMigration,
        sourceHash: null,
        sourceSize: null,
        detail: null,
      })
    }

    const deleted = await repository.listEntries(
      job.id,
      { state: "source_deleted" },
      { limit: MAX_BATCH_SIZE, offset: 0 },
    )
    for (const row of deleted) {
      if (!row.createdByMigration) {
        await repository.saveOutcome(job.id, row.key, {
          state: "reconciled",
          classification: "destination_only",
          detail:
            "This is no longer at the source. FlowCMS did not create the copy at the destination, " +
            "so it has been left alone.",
        })
        continue
      }

      try {
        if (row.kind === "directory") await destination.deletePrefix(row.key)
        else await destination.deleteObject(row.key)
      } catch {
        // Already gone, or unreachable. Either way the row below records the
        // intent, and a later pass retries.
      }
      await repository.saveOutcome(job.id, row.key, {
        state: "reconciled",
        detail: "Deleted from the source; the copy FlowCMS had made was removed with it.",
      })
    }
  }

  /**
   * Returns transient failures to the queue.
   *
   * DELIBERATELY NARROW. A conflict or an unrepresentable key is not a network
   * blip, and a Retry that quietly re-attempted them would either loop forever
   * or, if it ever "succeeded", would have overwritten somebody else's file.
   */
  async function retryFailed(migrationId: string) {
    const job = await requireOpenJob(migrationId)
    const retried = await repository.retryFailedEntries(job.id)
    if (retried === 0) {
      throw new MigrationServiceError(422, [
        "There are no failed transfers to retry. Conflicts and unrepresentable keys are not " +
          "retried automatically — they need resolving at the source or the destination, then a " +
          "fresh analysis.",
      ])
    }
    if (job.status === "blocked") {
      await transition(job, "inventorying", {
        sourceCursor: null,
        sourceScanCompletedAt: null,
        destinationCursor: null,
        destinationScanCompletedAt: null,
        // A NEW GENERATION, so everything this pass records is stamped with it
        // and anything left from the last one is recognisable as stale — with
        // no dependence on any node's clock.
        inventoryGeneration: job.inventoryGeneration + 1,
      })
    }
    return { retried, job: await describeActiveJob() }
  }

  // ---- acknowledgement ----------------------------------------------------

  /**
   * Records that the operator has seen the destination's extra files.
   *
   * PERSISTED WITH ITS COUNT, so it can expire. A checkbox in component state
   * survives neither a reload nor a second admin, and an acknowledgement of
   * three extras must not carry over to a destination that has since grown to
   * three hundred.
   */
  async function acknowledgeExtras(migrationId: string, expectedVersion: number) {
    const job = await requireOpenJob(migrationId)
    if (job.version !== expectedVersion) {
      throw new MigrationServiceError(409, [
        "This migration changed while you were looking at it. Reload and try again.",
      ])
    }

    const count = await repository.countEntriesMatching(job.id, {
      classification: "destination_only",
    })

    // A FIELD WRITE, NOT A TRANSITION. Acknowledging does not move the job
    // anywhere; asking the state machine whether `ready_to_cutover` may become
    // `ready_to_cutover` gets a correct refusal.
    await repository.patch(job.id, job.version, {
      extrasAcknowledged: true,
      extrasAcknowledgedAt: new Date(),
      extrasAcknowledgedCount: count,
    } as Partial<MigrationRow>)

    return { acknowledged: count, job: await describeActiveJob() }
  }

  // ---- cancelling ---------------------------------------------------------

  /**
   * Stops a migration before it has changed anything.
   *
   * NOTHING AT THE DESTINATION IS DELETED. Files this migration copied stay
   * where they are: they cost storage and nothing else, and removing them
   * automatically would mean a cancel button that deletes data — including, if
   * the ownership record were ever wrong, data the migration did not put there.
   */
  async function cancel(migrationId: string, expectedVersion: number, reason?: string) {
    const job = await requireOpenJob(migrationId)
    if (job.status === "cutting_over") {
      throw new MigrationServiceError(409, [
        "This migration is in the middle of its cutover and cannot be cancelled. Either the " +
          "storage location moved or it did not; wait for it to finish and reload.",
      ])
    }
    if (job.version !== expectedVersion) {
      throw new MigrationServiceError(409, [
        "This migration changed while you were looking at it. Reload and try again.",
      ])
    }

    try {
      await repository.cancel(job.id, job.version, reason)
    } catch (error) {
      throw asServiceError(error)
    }

    const copied = await repository.countEntriesMatching(job.id, { state: "verified" })
    return {
      cancelled: true,
      destinationRetained: copied,
      job: null,
    }
  }

  // ---- the irreversible step ---------------------------------------------

  /**
   * The cutover. Sequenced in exactly one place — see `performCutover`.
   *
   * This function deliberately adds nothing to the ordering: it resolves the
   * drivers and hands over. A route that could reach `commitActiveStorage`, the
   * lock, or the delta on its own would be a second implementation of the
   * critical section, and the two would drift.
   */
  async function cutover(migrationId: string): Promise<CutoverResult> {
    const job = await requireOpenJob(migrationId)
    const { source, destination } = await drivers(job)

    return performCutover(job.id, {
      repository,
      source,
      destination,
      destinationConfig: destinationConfigOf(job),
      acquireLock: deps.acquireLock,
      commit: deps.commit,
      clearCredentials: deps.clearCredentials,
      activeLocationId,
    })
  }

  async function recover(): Promise<RecoveryReport> {
    return reconcileStorageRecovery({
      repository,
      activeLocationId,
      clearCredentials: deps.clearCredentials,
      invalidateCaches: deps.invalidateCaches,
    })
  }

  // ---- internals ----------------------------------------------------------

  async function activeLocationId(): Promise<string | null> {
    const config = await deps.activeConfig().catch(() => null)
    return config ? storageLocationId(config) : null
  }

  /**
   * The job a MUTATION may act on.
   *
   * SCOPED TO THE OPEN JOB. Ids are opaque UUIDs, but a request that names a
   * finished migration and asks to advance it should be refused on what it IS
   * rather than on whether the caller could guess the id. A completed
   * relocation is a historical record and nothing may move it.
   */
  async function requireOpenJob(migrationId: string): Promise<MigrationRow> {
    const job = await repository.findById(migrationId)
    if (!job) throw new MigrationServiceError(404, ["That migration does not exist."])

    const active = await repository.findActive()
    if (!active || active.id !== job.id) {
      throw new MigrationServiceError(409, [
        "That migration is finished. It can still be read, but not changed.",
      ])
    }
    return job
  }

  /**
   * The job a READ may look at — open or finished.
   *
   * A completed migration is the record of an irreversible change to where an
   * installation keeps everything it has. Phase 4c made it unreadable the
   * moment it finished, which meant "what did that migration actually do" had
   * no answer six weeks later.
   *
   * Reading is still admin-only: the floor is in ROUTE_POLICIES, and it is the
   * same for an old job as for the current one. Being finished changes what may
   * be DONE to a migration, never who may see it.
   */
  async function requireReadableJob(migrationId: string): Promise<MigrationRow> {
    const job = await repository.findById(migrationId)
    if (!job) throw new MigrationServiceError(404, ["That migration does not exist."])
    return job
  }

  /**
   * Drivers for both ends.
   *
   * THE SOURCE IS CHECKED AGAINST THE JOB. If the active topology is no longer
   * the one the migration started from, every count and every hash it recorded
   * describes a different store, and continuing would be arithmetic on the
   * wrong numbers.
   */
  async function drivers(job: MigrationRow) {
    const active = await deps.activeConfig()
    if (storageLocationId(active) !== job.sourceLocationId) {
      throw new MigrationServiceError(409, [
        "This site's active storage is no longer the location this migration started from. It " +
          "has been stopped rather than continue against a different store.",
      ])
    }

    return {
      source: deps.createDriver(active),
      destination: deps.createDriver(destinationConfigOf(job)),
    }
  }

  function caseSensitivityOf(job: MigrationRow): KnownCaseSensitivity | null {
    if (job.destinationDriver !== "local") return null
    if (job.destinationCaseSensitive === null) {
      // FAILS CLOSED. The probe runs during the destination test and is
      // persisted; reaching here means it never produced a definite answer, and
      // there is no safe permissive default.
      throw new MigrationServiceError(409, [
        "FlowCMS has not determined how the destination filesystem treats upper and lower case, " +
          "so it will not analyse the migration. Test the destination again.",
      ])
    }
    return job.destinationCaseSensitive ? "sensitive" : "insensitive"
  }

  async function transition(
    job: MigrationRow,
    to: MigrationStatus,
    patch: Partial<MigrationRow> = {},
  ): Promise<MigrationRow> {
    try {
      return await repository.transition(job.id, job.version, to, patch)
    } catch (error) {
      throw asServiceError(error)
    }
  }

  return {
    snapshot,
    describeActiveJob,
    describeJob,
    history,
    entries,
    create,
    testDestination,
    runInventoryBatch,
    runTransferBatch,
    retryFailed,
    acknowledgeExtras,
    cancel,
    cutover,
    recover,
  }
}

export type MigrationService = ReturnType<typeof createMigrationService>

function normaliseMode(mode: string): MigrationMode {
  if (mode === "copy" || mode === "verify") return mode
  // NO DEFAULT. The two modes differ in whether FlowCMS writes a single file,
  // and guessing which one an operator meant is not a choice software gets to
  // make on their behalf.
  throw new MigrationServiceError(422, [
    'Choose how the files get to the destination: "copy" for FlowCMS to migrate them, or ' +
      '"verify" if you have already migrated them yourself.',
  ])
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/** Turns the repository's typed refusals into deterministic API conflicts. */
function asServiceError(error: unknown): unknown {
  if (error instanceof MigrationTransitionError) {
    const status: MigrationErrorStatus = error.reason === "not_found" ? 404 : 409
    return new MigrationServiceError(status, [error.message])
  }
  return error
}
