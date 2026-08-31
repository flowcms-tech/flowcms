import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { parseDatabaseConfig } from "@/Framework/Config/databaseConfig"
import { createDatabase, type DatabaseHandle } from "@/db/createDatabase"
import {
  createMigrationRepository,
  type MigrationRepository,
} from "@/Framework/Storage/Migration/migrationRepository"
import {
  advanceMigration,
  assessReadiness,
  readProgress,
  recoverAmbiguousEntry,
} from "@/Framework/Storage/Migration/migrationCoordinator"
import { createLocalStorageDriver } from "@/Framework/Storage/drivers/LocalStorageDriver"
import type { StorageDriver } from "@/Framework/Storage/StorageDriver"

/**
 * THE DRIVING LOOP, against a real database.
 *
 * Phase 4b1's engine returns outcomes; this is what makes progress durable. The
 * properties worth proving are the ones a mock cannot: that a claim is a real
 * conditional update, that a restarted run reads its whole position out of the
 * database, and that counters derived from rows cannot double-count on retry.
 */

let workspace: string
let handle: DatabaseHandle
let repo: MigrationRepository
let source: StorageDriver
let destination: StorageDriver

const bytes = (s: string) => Buffer.from(s, "utf8")
const sha = (s: string) => createHash("sha256").update(s).digest("hex")

const topology = {
  source: { driver: "s3", locationId: "s3:https://old|r|old-bucket", bucket: "old-bucket" },
  destination: { driver: "local", locationId: "local:/data/uploads", root: "/data/uploads" },
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-coord-"))
  const url = `file:${join(workspace, "test.db")}`

  const { createClient } = await import("@libsql/client")
  const { drizzle } = await import("drizzle-orm/libsql")
  const { migrate } = await import("drizzle-orm/libsql/migrator")
  const client = createClient({ url })
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/db/migrations/sqlite" })
  } finally {
    client.close()
  }

  handle = createDatabase(parseDatabaseConfig({ DATABASE_DIALECT: "sqlite", DATABASE_URL: url }))
  repo = createMigrationRepository({
    db: handle.db,
    migrations: handle.schema.storageMigrations,
    entries: handle.schema.storageMigrationEntries,
  })
}, 60_000)

afterAll(async () => {
  await handle?.close().catch(() => {})
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // Windows holds the handle briefly.
  }
})

beforeEach(async () => {
  await handle.db.delete(handle.schema.storageMigrationEntries)
  await handle.db.delete(handle.schema.storageMigrations)

  const stores = mkdtempSync(join(workspace, "run-"))
  source = createLocalStorageDriver(join(stores, "src"))
  destination = createLocalStorageDriver(join(stores, "dst"))
})

async function newJob(mode: "copy" | "verify" = "copy") {
  return repo.create({ mode, ...topology })
}

function deps(mode: "copy" | "verify" = "copy", runId?: string) {
  return { repository: repo, source, destination, mode, runId }
}

describe("claiming work", () => {
  it("claims and executes a batch, persisting every outcome", async () => {
    const job = await newJob()
    await source.uploadObject("a.txt", bytes("alpha"))
    await repo.recordEntry(job.id, {
      key: "a.txt",
      kind: "file",
      classification: "missing",
      state: "pending",
      sourceHash: sha("alpha"),
    })

    const result = await advanceMigration(job.id, deps())

    expect(result.claimed).toBe(1)
    expect(result.outcomes[0].state).toBe("verified")

    // Durable, not in memory: a fresh read sees it.
    const entry = await repo.findEntry(job.id, "a.txt")
    expect(entry?.state).toBe("verified")
    expect(entry?.createdByMigration).toBe(true)
    expect(entry?.destinationHash).toBe(sha("alpha"))
  })

  it("releases the claim after recording the outcome", async () => {
    // Otherwise a crash mid-execute would strand the entry behind its own lease.
    const job = await newJob()
    await source.uploadObject("a.txt", bytes("x"))
    await repo.recordEntry(job.id, {
      key: "a.txt", kind: "file", classification: "missing", state: "pending", sourceHash: sha("x"),
    })

    await advanceMigration(job.id, deps())

    const entry = await repo.findEntry(job.id, "a.txt")
    expect(entry?.claimedBy).toBeNull()
  })

  it("respects the batch size", async () => {
    const job = await newJob()
    for (let i = 0; i < 10; i += 1) {
      await source.uploadObject(`f-${i}.txt`, bytes(String(i)))
      await repo.recordEntry(job.id, {
        key: `f-${i}.txt`, kind: "file", classification: "missing", state: "pending",
        sourceHash: sha(String(i)),
      })
    }

    const result = await advanceMigration(job.id, deps(), { batchSize: 4 })

    expect(result.claimed).toBe(4)
  })

  it("reports exhaustion when nothing is claimable", async () => {
    const job = await newJob()

    expect(await advanceMigration(job.id, deps())).toEqual({
      claimed: 0, outcomes: [], exhausted: true,
    })
  })

  it("does not re-claim what is already verified", async () => {
    const job = await newJob()
    await repo.recordEntry(job.id, {
      key: "done.txt", kind: "file", classification: "matching", state: "verified",
    })

    expect((await advanceMigration(job.id, deps())).exhausted).toBe(true)
  })

  it("will not hand the same entry to a second live run", async () => {
    const job = await newJob()
    await repo.recordEntry(job.id, {
      key: "a.txt", kind: "file", classification: "missing", state: "pending",
    })

    const first = await repo.claimEntries(job.id, "run-A", 10)
    const second = await repo.claimEntries(job.id, "run-B", 10)

    expect(first).toHaveLength(1)
    // Two workers streaming to the same key interleaves into corruption on a
    // filesystem, so a live claim is exclusive.
    expect(second).toHaveLength(0)
  })

  it("lets the SAME run re-take its own claim, so a retry is not stranded", async () => {
    const job = await newJob()
    await repo.recordEntry(job.id, {
      key: "a.txt", kind: "file", classification: "missing", state: "pending",
    })

    await repo.claimEntries(job.id, "run-A", 10)
    expect(await repo.claimEntries(job.id, "run-A", 10)).toHaveLength(1)
  })

  it("reclaims a lease old enough that its holder cannot still be running", async () => {
    const job = await newJob()
    await repo.recordEntry(job.id, {
      key: "a.txt", kind: "file", classification: "missing", state: "pending",
    })
    await repo.claimEntries(job.id, "dead-run", 10)

    // A zero-length lease makes every claim stale — what a restart long after a
    // crash sees.
    expect(await repo.claimEntries(job.id, "new-run", 10, { leaseMs: 0 })).toHaveLength(1)
  })
})

describe("recovering an ambiguous entry", () => {
  const ambiguous = (over = {}) => ({
    key: "a.txt", kind: "file" as const, classification: "missing",
    state: "copied" as const, sourceSize: null, sourceHash: sha("payload"),
    createdByMigration: true, ...over,
  })

  it("marks it verified when the destination already matches", async () => {
    // The write completed; only the bookkeeping was lost.
    await destination.uploadObject("a.txt", bytes("payload"))

    const outcome = await recoverAmbiguousEntry(ambiguous(), destination)

    expect(outcome?.state).toBe("verified")
  })

  it("re-executes when the destination holds OUR incomplete write", async () => {
    await destination.uploadObject("a.txt", bytes("trunc"))

    // null means "hand it back to the engine", which replaces it.
    expect(await recoverAmbiguousEntry(ambiguous({ createdByMigration: true }), destination)).toBeNull()
  })

  it("BLOCKS when the destination differs and ownership cannot be proven", async () => {
    // The case that protects data: a database failure could leave ownership
    // unrecorded, and treating "I do not know who wrote this" as "I did" is how
    // a migration overwrites a file it never owned.
    await destination.uploadObject("a.txt", bytes("somebody else's file"))

    const outcome = await recoverAmbiguousEntry(ambiguous({ createdByMigration: false }), destination)

    expect(outcome?.state).toBe("blocked")
    expect(outcome?.detail).toMatch(/cannot prove/i)
  })

  it("re-executes when nothing landed at all", async () => {
    expect(await recoverAmbiguousEntry(ambiguous(), destination)).toBeNull()
  })

  it("never blindly re-uploads a matching object", async () => {
    await destination.uploadObject("a.txt", bytes("payload"))
    const write = vi.spyOn(destination, "writeObjectStream")

    await recoverAmbiguousEntry(ambiguous(), destination)

    expect(write).not.toHaveBeenCalled()
  })

  it("runs recovery through the coordinator, not just in isolation", async () => {
    const job = await newJob()
    await source.uploadObject("a.txt", bytes("payload"))
    await destination.uploadObject("a.txt", bytes("payload"))
    await repo.recordEntry(job.id, {
      key: "a.txt", kind: "file", classification: "missing", state: "copied",
      sourceHash: sha("payload"),
    })

    const result = await advanceMigration(job.id, deps())

    expect(result.outcomes[0].state).toBe("verified")
    expect((await repo.findEntry(job.id, "a.txt"))?.state).toBe("verified")
  })
})

describe("resuming after a restart", () => {
  it("reads its whole position from the database", async () => {
    const job = await newJob()
    for (const n of ["a", "b", "c"]) {
      await source.uploadObject(`${n}.txt`, bytes(n))
      await repo.recordEntry(job.id, {
        key: `${n}.txt`, kind: "file", classification: "missing", state: "pending",
        sourceHash: sha(n),
      })
    }

    await advanceMigration(job.id, deps("copy", "run-1"), { batchSize: 2 })

    // A completely fresh repository and run — what a restarted process has.
    const fresh = createMigrationRepository({
      db: handle.db,
      migrations: handle.schema.storageMigrations,
      entries: handle.schema.storageMigrationEntries,
    })
    const result = await advanceMigration(
      job.id,
      { repository: fresh, source, destination, mode: "copy", runId: "run-2" },
      { leaseMs: 0 },
    )

    expect(result.claimed).toBe(1)
    const progress = await readProgress(job.id, fresh)
    expect(progress.verified).toBe(3)
  })

  it("does not re-copy what was already verified", async () => {
    const job = await newJob()
    await source.uploadObject("a.txt", bytes("x"))
    await repo.recordEntry(job.id, {
      key: "a.txt", kind: "file", classification: "missing", state: "pending", sourceHash: sha("x"),
    })
    await advanceMigration(job.id, deps())

    const write = vi.spyOn(destination, "writeObjectStream")
    await advanceMigration(job.id, deps())

    expect(write).not.toHaveBeenCalled()
  })
})

describe("progress is derived, not accumulated", () => {
  it("counts rows rather than incrementing", async () => {
    // Incrementing per completed entry is how a retry counts the same object
    // twice and how a crash between the object write and the counter write
    // loses one forever.
    const job = await newJob()
    for (const n of ["a", "b"]) {
      await source.uploadObject(`${n}.txt`, bytes(n))
      await repo.recordEntry(job.id, {
        key: `${n}.txt`, kind: "file", classification: "missing", state: "pending",
        sourceHash: sha(n),
      })
    }

    await advanceMigration(job.id, deps())
    await advanceMigration(job.id, deps())
    await advanceMigration(job.id, deps())

    const progress = await readProgress(job.id, repo)
    expect(progress.verified).toBe(2)
    expect(progress.total).toBe(2)
  })

  it("one failure does not corrupt its neighbours", async () => {
    const job = await newJob()
    await source.uploadObject("good.txt", bytes("fine"))
    await repo.recordEntry(job.id, {
      key: "good.txt", kind: "file", classification: "missing", state: "pending",
      sourceHash: sha("fine"),
    })
    await repo.recordEntry(job.id, {
      key: "gone.txt", kind: "file", classification: "missing", state: "pending",
    })

    await advanceMigration(job.id, deps())

    expect((await repo.findEntry(job.id, "good.txt"))?.state).toBe("verified")
    expect((await repo.findEntry(job.id, "gone.txt"))?.state).toBe("source_deleted")
  })
})

describe("readiness is not 'the batches finished'", () => {
  async function seed(entries: { key: string; classification: string; state: string }[]) {
    const job = await newJob()
    for (const e of entries) {
      await repo.recordEntry(job.id, { key: e.key, kind: "file", classification: e.classification, state: e.state })
    }
    return job
  }

  it("is ready when everything is verified", async () => {
    const job = await seed([{ key: "a", classification: "missing", state: "verified" }])

    expect((await assessReadiness(job.id, repo, "copy")).ready).toBe(true)
  })

  it.each([
    ["a blocked entry", { key: "a", classification: "missing", state: "blocked" }],
    ["a failed entry", { key: "a", classification: "missing", state: "failed" }],
    ["an unprocessed entry", { key: "a", classification: "missing", state: "pending" }],
    ["an unverified write", { key: "a", classification: "missing", state: "copied" }],
    ["an in-flight write", { key: "a", classification: "missing", state: "copying" }],
    ["a changed source", { key: "a", classification: "missing", state: "source_changed" }],
    ["a deleted source", { key: "a", classification: "missing", state: "source_deleted" }],
    ["an incompatible key", { key: "a", classification: "incompatible", state: "blocked" }],
    ["a conflict", { key: "a", classification: "conflicting", state: "blocked" }],
  ])("is NOT ready with %s", async (_label, entry) => {
    const job = await seed([entry])

    const verdict = await assessReadiness(job.id, repo, "copy")
    expect(verdict.ready).toBe(false)
    expect(verdict.reasons.length).toBeGreaterThan(0)
  })

  it("names every reason, not just the first", async () => {
    const job = await seed([
      { key: "a", classification: "conflicting", state: "blocked" },
      { key: "b", classification: "incompatible", state: "blocked" },
    ])

    expect((await assessReadiness(job.id, repo, "copy")).reasons.length).toBeGreaterThanOrEqual(2)
  })

  it("in verify-only mode, a missing file blocks readiness", async () => {
    // The operator claimed the files were already there.
    const job = await seed([{ key: "a", classification: "missing", state: "blocked" }])

    const verdict = await assessReadiness(job.id, repo, "verify")
    expect(verdict.ready).toBe(false)
    expect(verdict.reasons.join(" ")).toMatch(/already migrated/i)
  })

  it("destination-only extras do not block", async () => {
    const job = await seed([{ key: "extra", classification: "destination_only", state: "verified" }])

    expect((await assessReadiness(job.id, repo, "copy")).ready).toBe(true)
  })
})

describe("the coordinator cannot change active storage", () => {
  it("imports nothing that could", async () => {
    const { readFileSync } = await import("node:fs")
    const src = readFileSync("src/Framework/Storage/Migration/migrationCoordinator.ts", "utf8")
    const imports = [...src.matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1])

    // Advancing a migration is claiming, copying, verifying and counting.
    // Making the destination authoritative lives in `cutover.ts`, behind its
    // own entry point — and nothing on this list can reach it.
    expect(imports.sort()).toEqual([
      "../StorageDriver",
      "../StorageErrors",
      "./contentHash",
      "./migrationEngine",
      "./migrationRepository",
      "./migrationState",
      "node:crypto",
    ])
  })
})
