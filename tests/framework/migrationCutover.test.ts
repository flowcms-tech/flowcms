import { describe, expect, it } from "vitest"
import {
  CUTOVER_WINDOW_MS,
  assessRecovery,
  destinationConfigOf,
  windowExpired,
} from "@/Framework/Storage/Migration/cutover"
import type { MigrationRow } from "@/Framework/Storage/Migration/migrationRepository"

/**
 * THE IRREVERSIBLE STEP, AND EVERYTHING ARRANGED AROUND IT.
 *
 * The invariant every test here defends:
 *
 *   Until the transaction commits, the SOURCE is authoritative.
 *
 * The recovery cases matter most. A process can die at any point in the
 * critical section, and the question a restart must answer — "which storage is
 * authoritative right now" — is NOT answerable from the migration's status: a
 * crash between the transaction committing and the job row being observed
 * leaves a row saying `cutting_over` about an installation that has already
 * moved. The active snapshot is the fact; the job status is a description of an
 * attempt.
 */

function job(over: Partial<MigrationRow> = {}): MigrationRow {
  return {
    id: "job-1",
    status: "cutting_over",
    mode: "copy",
    sourceDriver: "s3",
    sourceLocationId: "s3:https://old|r1|old-bucket",
    sourceEndpoint: "https://old",
    sourceRegion: "r1",
    sourceBucket: "old-bucket",
    sourceRoot: null,
    destinationDriver: "local",
    destinationLocationId: "local:/data/uploads",
    destinationEndpoint: null,
    destinationRegion: null,
    destinationBucket: null,
    destinationRoot: "/data/uploads",
    destinationAccessKeyId: null,
    destinationSecretAccessKey: null,
    version: 3,
    cutoverStartedAt: new Date(),
    ...over,
  } as unknown as MigrationRow
}

describe("rebuilding the destination configuration from the job", () => {
  it("rebuilds a local destination", () => {
    expect(destinationConfigOf(job())).toEqual({ driver: "local", root: "/data/uploads" })
  })

  it("rebuilds an s3 destination with its credentials", () => {
    // The credentials travel WITH the location: switching the active bucket
    // without the key that opens it would leave an installation authoritatively
    // pointed somewhere it cannot read.
    const config = destinationConfigOf(
      job({
        destinationDriver: "s3",
        destinationEndpoint: "https://new",
        destinationRegion: "r2",
        destinationBucket: "new-bucket",
        destinationRoot: null,
        destinationAccessKeyId: "AKIA-NEW",
        destinationSecretAccessKey: "secret-new",
      }),
    )

    expect(config).toEqual({
      driver: "s3",
      endpoint: "https://new",
      region: "r2",
      bucket: "new-bucket",
      accessKeyId: "AKIA-NEW",
      secretAccessKey: "secret-new",
    })
  })
})

describe("the critical window is bounded", () => {
  it("is not expired immediately", () => {
    expect(windowExpired(job({ cutoverStartedAt: new Date() }))).toBe(false)
  })

  it("expires after the limit", () => {
    // Every storage mutation in the application is refused while it is open, so
    // an unbounded window is an unbounded outage.
    const long_ago = new Date(Date.now() - CUTOVER_WINDOW_MS - 1000)

    expect(windowExpired(job({ cutoverStartedAt: long_ago }))).toBe(true)
  })

  it("is not expired when no cutover has started", () => {
    expect(windowExpired(job({ cutoverStartedAt: null }))).toBe(false)
  })

  it("measures from its own timestamp, not from updatedAt", () => {
    // `updatedAt` moves on every progress write, so a cutover reconciling for
    // twenty minutes would look like it started a second ago.
    const started = new Date(Date.now() - CUTOVER_WINDOW_MS - 1)
    expect(windowExpired(job({ cutoverStartedAt: started, updatedAt: new Date() } as never))).toBe(
      true,
    )
  })
})

describe("recovery decides from the ACTIVE SNAPSHOT, not the job status", () => {
  it("says idle when no cutover was running", () => {
    expect(assessRecovery(job({ status: "ready" }), "s3:https://old|r1|old-bucket")).toEqual({
      outcome: "idle",
    })
  })

  it("says idle when there is no job at all", () => {
    expect(assessRecovery(null, "s3:https://old|r1|old-bucket")).toEqual({ outcome: "idle" })
  })

  it("crash after lock, before commit -> source still authoritative", () => {
    const verdict = assessRecovery(job(), "s3:https://old|r1|old-bucket")

    expect(verdict).toEqual({ outcome: "interrupted_before_commit", migrationId: "job-1" })
  })

  it("crash after commit, before the job row caught up -> destination authoritative", () => {
    // The transaction committed. Whatever the job row says, the files are at
    // the destination — and reverting would discard anything written there
    // since.
    const verdict = assessRecovery(job(), "local:/data/uploads")

    expect(verdict).toEqual({ outcome: "committed_needs_finalising", migrationId: "job-1" })
  })

  it("never reverts a committed cutover", () => {
    const verdict = assessRecovery(job(), "local:/data/uploads")

    expect(verdict.outcome).not.toBe("interrupted_before_commit")
  })

  it("refuses to guess when the topology is neither side", () => {
    // Something outside this migration changed storage. Switching either way
    // could be the wrong one, so it reports and stops — leaving writes blocked
    // rather than silently choosing.
    const verdict = assessRecovery(job(), "s3:https://somewhere-else|r9|other")

    expect(verdict).toEqual({ outcome: "unexpected_topology", migrationId: "job-1" })
  })

  it("refuses to guess when there is no active snapshot at all", () => {
    expect(assessRecovery(job(), null).outcome).toBe("unexpected_topology")
  })

  it("gives every outcome a migration to act on", () => {
    for (const active of [
      "s3:https://old|r1|old-bucket",
      "local:/data/uploads",
      "s3:https://elsewhere|r|x",
    ]) {
      const verdict = assessRecovery(job(), active)
      if (verdict.outcome !== "idle") expect(verdict.migrationId).toBe("job-1")
    }
  })
})

describe("idempotency", () => {
  it("a second recovery of a committed cutover reaches the same conclusion", () => {
    // Recovery must be safe to run repeatedly; it never toggles anything.
    const first = assessRecovery(job(), "local:/data/uploads")
    const second = assessRecovery(job(), "local:/data/uploads")

    expect(second).toEqual(first)
  })

  it("a completed job is idle whatever the topology says", () => {
    expect(assessRecovery(job({ status: "completed" }), "local:/data/uploads").outcome).toBe("idle")
    expect(assessRecovery(job({ status: "completed" }), "s3:https://old|r1|old-bucket").outcome).toBe(
      "idle",
    )
  })
})
