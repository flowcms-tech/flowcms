import { createHash } from "node:crypto"
import { digestObject } from "./contentHash"
import { StorageObjectNotFoundError } from "../StorageErrors"
import type { MigrationMode } from "./migrationState"
import type { StorageDriver } from "../StorageDriver"

/**
 * MOVING THE BYTES — and, in verify-only mode, moving none of them.
 *
 * This is the execution half of a relocation. It reads the classification
 * Phase 4a persisted and acts on it, in bounded batches, with every decision
 * written down before the next one starts.
 *
 * WHAT IT CANNOT DO, BY CONSTRUCTION: change where FlowCMS reads from. It has
 * no access to `commitActiveStorage`, no access to the settings row, and no
 * concept of an active driver — it is handed a source and a destination and
 * writes only to the destination. A completed run leaves the site serving
 * exactly what it served before; making the destination authoritative is a
 * later phase's single transaction.
 *
 * THE BASELINE IS A SNAPSHOT, NOT A PROMISE ABOUT NOW. The source stays live
 * throughout — an editor can upload, replace or delete a file while this runs.
 * So reaching the end means "the destination matches the source as it was when
 * inventory ran", and nothing stronger. Detecting what changed since is the
 * final delta's job, and this engine's contribution is to record honestly which
 * entries it could no longer vouch for.
 */

/** Per-entry execution progress. Distinct from classification. */
export const ENTRY_EXECUTION_STATES = [
  /** Classified, nothing done. */
  "pending",
  /** A write was STARTED. Anything found in this state after a restart is of
   *  unknown completeness and must be re-verified, never assumed finished. */
  "copying",
  /** Written, not yet proven. */
  "copied",
  /** Read back from the destination and byte-identical to the baseline. */
  "verified",
  /** Transient failure; a retry may clear it. */
  "failed",
  /** Blocked on something a human must resolve. */
  "blocked",
  /** The source changed under us; the baseline no longer describes it. */
  "source_changed",
  /** The source went away; the baseline entry is stale. */
  "source_deleted",
] as const

export type EntryExecutionState = (typeof ENTRY_EXECUTION_STATES)[number]

/** One unit of work, as the engine needs it. */
export interface ExecutableEntry {
  key: string
  kind: "file" | "directory"
  classification: string
  state: EntryExecutionState
  /** From baseline inventory. The thing the destination must end up matching. */
  sourceSize: number | null
  sourceHash: string | null
  createdByMigration: boolean
}

export interface EntryOutcome {
  key: string
  state: EntryExecutionState
  /** True only once THIS migration has written the destination object. */
  createdByMigration: boolean
  destinationSize?: number
  destinationHash?: string
  detail?: string
}

export interface ExecuteOptions {
  mode: MigrationMode
  source: StorageDriver
  destination: StorageDriver
  /** Bounded. Never `Promise.all` over an unbounded list. */
  concurrency?: number
}

const DEFAULT_CONCURRENCY = 4

/**
 * Runs one entry to completion, or records why it could not be.
 *
 * ONE ENTRY, ONE OUTCOME, NO SIDE EFFECTS BEYOND THE DESTINATION WRITE. The
 * caller persists the outcome; this function does not touch the database, which
 * is what lets it be retried, run concurrently with others, and tested without
 * one.
 */
export async function executeEntry(
  entry: ExecutableEntry,
  options: ExecuteOptions,
): Promise<EntryOutcome> {
  const { mode, source, destination } = options

  // ---- Things no mode may act on ------------------------------------------
  if (entry.classification === "incompatible" || entry.classification === "conflicting") {
    // Both block, in both modes. An incompatible key has no resolution FlowCMS
    // may choose — renaming it would break every stored reference. A conflict
    // means different bytes are already at the destination under this key, and
    // overwriting is how somebody loses the file that was there.
    return {
      key: entry.key,
      state: "blocked",
      createdByMigration: entry.createdByMigration,
      detail:
        entry.classification === "incompatible"
          ? "This key cannot be represented at the destination."
          : "A different file with the same name is already at the destination.",
    }
  }

  if (entry.classification === "destination_only") {
    // Never touched, never deleted. Recorded so cutover can require an
    // acknowledgement that it will become visible.
    return { key: entry.key, state: "verified", createdByMigration: false }
  }

  // ---- VERIFY-ONLY MODE: no destination writes, ever -----------------------
  if (mode === "verify") {
    if (entry.classification === "matching") {
      return { key: entry.key, state: "verified", createdByMigration: false }
    }
    // `missing` in verify-only mode is the operator's claim being false. They
    // said the files were already there; this one is not. Copying it quietly
    // would answer a question they did not ask and would hide that their own
    // migration was incomplete.
    return {
      key: entry.key,
      state: "blocked",
      createdByMigration: false,
      detail:
        "This is at the source and not at the destination. You chose to verify a migration you " +
        "had already done, so FlowCMS has not copied it.",
    }
  }

  // ---- COPY MODE -----------------------------------------------------------
  if (entry.classification === "matching") {
    // Already identical. Recorded as verified against the baseline, and NOT
    // marked migration-owned: FlowCMS did not put it there, so the final
    // reconciliation must never remove it.
    return { key: entry.key, state: "verified", createdByMigration: false }
  }

  if (entry.kind === "directory") {
    return copyDirectory(entry, destination)
  }

  return copyFile(entry, source, destination)
}

/**
 * An empty logical folder.
 *
 * The two backends express it differently — a zero-byte marker object on S3, a
 * real directory on a filesystem — and `createDirectory` is exactly the seam
 * that already knows which. Idempotent on both, so a retry is free.
 *
 * Only EMPTY directories reach here: inventory does not emit an entry for a
 * folder that has files, because those exist at the destination as soon as
 * their files are written. Creating a marker for every prefix would litter an
 * S3 destination with objects nobody asked for.
 */
async function copyDirectory(
  entry: ExecutableEntry,
  destination: StorageDriver,
): Promise<EntryOutcome> {
  try {
    await destination.createDirectory(entry.key)
  } catch (error) {
    return {
      key: entry.key,
      state: "failed",
      createdByMigration: entry.createdByMigration,
      detail: describeFailure(error),
    }
  }

  return { key: entry.key, state: "verified", createdByMigration: true }
}

/**
 * Streams a file across, then PROVES it arrived.
 *
 * Upload success is not evidence. A backend can accept bytes and store
 * something else — a truncated write, a proxy that rewrote the body, a
 * misconfigured bucket — and the only way to know is to read it back and hash
 * it. That read is the difference between "we sent it" and "it is there".
 *
 * The source is hashed WHILE it is streamed, in the same pass, so a large file
 * is read once rather than twice and the hash describes the exact bytes that
 * were written rather than a separate read that might have seen a different
 * version.
 */
async function copyFile(
  entry: ExecutableEntry,
  source: StorageDriver,
  destination: StorageDriver,
): Promise<EntryOutcome> {
  const hash = createHash("sha256")
  let observedSize = 0

  let stream: AsyncIterable<Uint8Array>
  try {
    stream = await source.openReadStream(entry.key)
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      // Deleted from the live source since inventory. Not a failure of this
      // migration — the store is in use — and not something to retry forever.
      // The final delta decides what to do about it.
      return {
        key: entry.key,
        state: "source_deleted",
        createdByMigration: entry.createdByMigration,
        detail: "This was deleted from the source after the inventory ran.",
      }
    }
    return {
      key: entry.key,
      state: "failed",
      createdByMigration: entry.createdByMigration,
      detail: describeFailure(error),
    }
  }

  // Tee: every chunk goes to the destination and to the digest, and nothing is
  // retained, so peak memory is one chunk regardless of object size.
  async function* teed(): AsyncGenerator<Uint8Array> {
    for await (const chunk of stream) {
      hash.update(chunk)
      observedSize += chunk.byteLength
      yield chunk
    }
  }

  try {
    await destination.writeObjectStream(entry.key, teed(), {
      contentLength: entry.sourceSize ?? undefined,
    })
  } catch (error) {
    // CLOSE THE SOURCE. If the destination rejected the write before consuming
    // the body — a permission error on the first byte, say — nothing ever
    // iterated `teed()`, so the underlying read stream was opened and then
    // abandoned. One leaked descriptor per failure is a migration that runs out
    // of them on a bad destination, at which point the failures stop looking
    // like destination failures.
    closeStream(stream)
    // The write failed part-way. The destination object is of unknown
    // completeness, and it is OURS — this migration started it — so a retry may
    // safely replace it. That ownership is recorded even on failure, precisely
    // so the retry knows it is allowed to overwrite.
    return {
      key: entry.key,
      state: "failed",
      createdByMigration: true,
      detail: describeFailure(error),
    }
  }

  const sourceHash = hash.digest("hex")

  // Did the source change underneath us? The baseline hash is what the
  // destination is supposed to end up matching, and if the bytes we just read
  // differ from it then this entry can no longer be vouched for against that
  // baseline — whatever we wrote is a valid copy of something, but not of the
  // thing that was inventoried.
  if (entry.sourceHash && entry.sourceHash !== sourceHash) {
    return {
      key: entry.key,
      state: "source_changed",
      createdByMigration: true,
      destinationSize: observedSize,
      destinationHash: sourceHash,
      detail: "This changed at the source after the inventory ran.",
    }
  }

  // READ IT BACK. The claim being made is about the destination, so the
  // destination is what gets measured.
  let verified
  try {
    verified = await digestObject(destination, entry.key)
  } catch (error) {
    return {
      key: entry.key,
      state: "copied",
      createdByMigration: true,
      detail: `Written, but could not be read back to verify: ${describeFailure(error)}`,
    }
  }

  if (verified.hash !== sourceHash) {
    return {
      key: entry.key,
      state: "failed",
      createdByMigration: true,
      destinationSize: verified.size,
      destinationHash: verified.hash,
      detail: "The destination stored different bytes than were sent to it.",
    }
  }

  return {
    key: entry.key,
    state: "verified",
    createdByMigration: true,
    destinationSize: verified.size,
    destinationHash: verified.hash,
  }
}

/**
 * Releases a source stream that will not be read to completion.
 *
 * `AsyncIterable` says nothing about cleanup, so both escape hatches are tried:
 * Node streams expose `destroy()`, and a generator exposes `return()` on its
 * iterator. Failing to release either is a leaked file descriptor or an open
 * HTTP response.
 */
function closeStream(stream: AsyncIterable<Uint8Array>): void {
  const closable = stream as Partial<{
    destroy: () => void
    on: (event: string, handler: (error: unknown) => void) => void
  }>
  try {
    // THE LISTENER GOES ON FIRST, and it is not defensive clutter. A Node file
    // stream opens asynchronously, so destroying one whose open is still in
    // flight still delivers the open's failure as an `error` event — and an
    // `error` event with no listener is an unhandled exception that takes the
    // process down. The stream is already being abandoned; its dying complaint
    // is not news.
    closable.on?.("error", () => {})
    closable.destroy?.()
  } catch {
    // Already gone.
  }
}

/**
 * Runs a batch with BOUNDED concurrency.
 *
 * Never `Promise.all` over the whole list: a batch of ten thousand entries
 * would open ten thousand simultaneous connections, exhaust the file
 * descriptors or the S3 connection pool, and fail in a way that looks like the
 * destination being broken.
 *
 * A worker pool over a shared index rather than fixed slices, so one slow large
 * file does not leave the other workers idle.
 */
export async function executeBatch(
  entries: readonly ExecutableEntry[],
  options: ExecuteOptions,
): Promise<EntryOutcome[]> {
  const limit = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const outcomes: EntryOutcome[] = new Array(entries.length)
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = next
      next += 1
      if (index >= entries.length) return
      outcomes[index] = await executeEntry(entries[index], options)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, worker))
  return outcomes
}

/**
 * Redacted, operator-facing failure text.
 *
 * Never the raw error: an S3 error carries the bucket and endpoint, and an
 * endpoint can carry credentials in its userinfo.
 */
function describeFailure(error: unknown): string {
  const named = error as { name?: string; code?: string }
  const code = named?.code ?? named?.name ?? ""

  if (code === "AccessDenied") return "the destination refused the write"
  if (code === "EACCES" || code === "EPERM") return "permission denied at the destination"
  if (code === "ENOSPC") return "the destination is full"
  if (code === "TimeoutError" || code === "ETIMEDOUT") return "the destination timed out"
  return "the transfer did not complete"
}

/**
 * Whether an entry's recorded state can be trusted after a restart.
 *
 * `copying` cannot: a process that died mid-write leaves a row saying it
 * started and a destination object of unknown completeness. Treating that as
 * finished is how a truncated file becomes a verified one.
 */
export function needsReverificationAfterRestart(state: EntryExecutionState): boolean {
  return state === "copying" || state === "copied"
}
