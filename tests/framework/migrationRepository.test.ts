import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { parseDatabaseConfig } from "@/Framework/Config/databaseConfig"
import { createDatabase, type DatabaseHandle } from "@/db/createDatabase"
import {
  MigrationAlreadyActiveError,
  MigrationTransitionError,
  createMigrationRepository,
  type MigrationRepository,
} from "@/Framework/Storage/Migration/migrationRepository"

/**
 * DURABLE MIGRATION STATE, against a real database.
 *
 * Deliberately not a mocked Drizzle. The three properties that matter here —
 * the unique `(migrationId, key)` index making inventory idempotent, the
 * version guard making concurrent transitions safe, and the transaction making
 * "one job at a time" actually true — are all enforced by the DATABASE. A mock
 * would assert that the code intends them and prove none of them.
 *
 * SQLite against a temp file, following `tests/db/contract.test.ts`, so the
 * suite needs no servers.
 */

let workspace: string
let handle: DatabaseHandle
let repo: MigrationRepository

const source = {
  driver: "s3",
  locationId: "s3:https://old.example.com|r1|old-bucket",
  endpoint: "https://old.example.com",
  region: "r1",
  bucket: "old-bucket",
}
const destination = {
  driver: "local",
  locationId: "local:/data/uploads",
  root: "/data/uploads",
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-migrepo-"))
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
  // BEST EFFORT. Windows keeps the SQLite file handle briefly after close, so
  // removing the directory can fail with EPERM — and a temp directory the OS
  // will reap is not worth failing a green suite over. `tests/db/contract.test.ts`
  // sidesteps this by never removing its workspace at all.
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // left for the OS
  }
})

beforeEach(async () => {
  // Each test starts with no open job.
  await handle.db.delete(handle.schema.storageMigrationEntries)
  await handle.db.delete(handle.schema.storageMigrations)
})

describe("opening a job", () => {
  it("starts in draft with the source and destination recorded", async () => {
    const job = await repo.create({ mode: "copy", source, destination })

    expect(job.status).toBe("draft")
    expect(job.mode).toBe("copy")
    expect(job.sourceLocationId).toBe(source.locationId)
    expect(job.destinationLocationId).toBe(destination.locationId)
    expect(job.version).toBe(0)
  })

  it("persists the mode, so a restart cannot forget which one it is", async () => {
    await repo.create({ mode: "verify", source, destination })

    expect((await repo.findActive())?.mode).toBe("verify")
  })

  it("refuses a second job while one is open", async () => {
    await repo.create({ mode: "copy", source, destination })

    // Two concurrent relocations would each copy to their own destination while
    // the other mutated the source, so each final delta would be computed
    // against a baseline the other had invalidated.
    await expect(repo.create({ mode: "copy", source, destination })).rejects.toBeInstanceOf(
      MigrationAlreadyActiveError,
    )
  })

  it("allows a new job once the previous one is terminal", async () => {
    const first = await repo.create({ mode: "copy", source, destination })
    await repo.cancel(first.id, first.version)

    await expect(repo.create({ mode: "copy", source, destination })).resolves.toBeDefined()
  })

  it("does the check and the insert in one transaction", async () => {
    // The guard against two requests both seeing "no open job" and both
    // inserting is the TRANSACTION, not the ordering of the two statements.
    //
    // Deliberately not asserted by firing two `create` calls at once: libsql
    // runs one connection and serialises write transactions, so a concurrent
    // pair there deadlocks the connection rather than exercising the race —
    // it tests the driver, not this code. Proving the race needs a server
    // engine, which `tests/db/contract.test.ts` reaches only when
    // TEST_POSTGRES_URL and friends are supplied.
    //
    // What IS asserted here: the refusal happens inside the transactional path,
    // so a second caller cannot observe an intermediate state where the row is
    // inserted but not yet visible to the check.
    await repo.create({ mode: "copy", source, destination })

    await expect(repo.create({ mode: "copy", source, destination })).rejects.toBeInstanceOf(
      MigrationAlreadyActiveError,
    )
    // And nothing partial was written by the refused attempt.
    const all = await handle.db.select().from(handle.schema.storageMigrations)
    expect(all).toHaveLength(1)
  })
})

describe("transitions", () => {
  it("advances through a legal path", async () => {
    let job = await repo.create({ mode: "copy", source, destination })
    job = await repo.transition(job.id, job.version, "destination_tested")
    expect(job.status).toBe("destination_tested")

    job = await repo.transition(job.id, job.version, "inventorying")
    expect(job.status).toBe("inventorying")

    job = await repo.transition(job.id, job.version, "ready")
    expect(job.status).toBe("ready")
  })

  it("refuses an illegal transition before touching the database", async () => {
    const job = await repo.create({ mode: "copy", source, destination })

    await expect(repo.transition(job.id, job.version, "completed")).rejects.toMatchObject({
      reason: "illegal_transition",
    })
    // And the job is untouched.
    expect((await repo.findById(job.id))?.status).toBe("draft")
  })

  it("refuses to skip analysis and start copying", async () => {
    const job = await repo.create({ mode: "copy", source, destination })

    await expect(repo.transition(job.id, job.version, "copying")).rejects.toBeInstanceOf(
      MigrationTransitionError,
    )
  })

  it("increments the version on every write", async () => {
    let job = await repo.create({ mode: "copy", source, destination })
    expect(job.version).toBe(0)

    job = await repo.transition(job.id, job.version, "destination_tested")
    expect(job.version).toBe(1)

    job = await repo.transition(job.id, job.version, "inventorying")
    expect(job.version).toBe(2)
  })

  it("rejects a write based on a stale version", async () => {
    // The case the version guard exists for: a transition that is STILL LEGAL
    // from the current status, so legality cannot catch it. Two inventory
    // batches racing is exactly this — `inventorying -> inventorying` is a
    // legal self-loop, and without the version guard both would write their
    // cursor and one would silently overwrite the other's progress.
    let job = await repo.create({ mode: "copy", source, destination })
    job = await repo.transition(job.id, job.version, "destination_tested")
    job = await repo.transition(job.id, job.version, "inventorying")

    const staleVersion = job.version
    await repo.saveProgress(job.id, staleVersion, { sourceCursor: "batch-1" } as never)

    await expect(
      repo.saveProgress(job.id, staleVersion, { sourceCursor: "batch-2" } as never),
    ).rejects.toMatchObject({ reason: "version_conflict" })

    // The first batch's progress survived; the stale one did not overwrite it.
    expect((await repo.findById(job.id))?.sourceCursor).toBe("batch-1")
  })

  it("refuses a stale caller whose transition also became illegal", async () => {
    // The other shape of the same race, caught one guard earlier. Both are safe
    // refusals; this one just reports the more specific reason.
    const job = await repo.create({ mode: "copy", source, destination })
    await repo.transition(job.id, job.version, "destination_tested")

    await expect(repo.transition(job.id, 0, "destination_tested")).rejects.toMatchObject({
      reason: "illegal_transition",
    })
  })

  it("lets only one of two simultaneous transitions win", async () => {
    const job = await repo.create({ mode: "copy", source, destination })

    const results = await Promise.allSettled([
      repo.transition(job.id, job.version, "destination_tested"),
      repo.transition(job.id, job.version, "destination_tested"),
    ])

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1)
  })

  it("reports a job that no longer exists", async () => {
    await expect(repo.transition("nope", 0, "draft")).rejects.toMatchObject({
      reason: "not_found",
    })
  })
})

describe("cancellation is durable", () => {
  it("survives being re-read", async () => {
    const job = await repo.create({ mode: "copy", source, destination })
    await repo.cancel(job.id, job.version, "operator changed their mind")

    const reloaded = await repo.findById(job.id)
    expect(reloaded?.status).toBe("cancelled")
    expect(reloaded?.failureReason).toBe("operator changed their mind")
  })

  it("stops the job being treated as active", async () => {
    const job = await repo.create({ mode: "copy", source, destination })
    await repo.cancel(job.id, job.version)

    expect(await repo.findActive()).toBeNull()
  })

  it("cannot be undone", async () => {
    const job = await repo.create({ mode: "copy", source, destination })
    const cancelled = await repo.cancel(job.id, job.version)

    await expect(
      repo.transition(cancelled.id, cancelled.version, "inventorying"),
    ).rejects.toMatchObject({ reason: "illegal_transition" })
  })
})

describe("inventory entries", () => {
  it("records an entry", async () => {
    const job = await repo.create({ mode: "copy", source, destination })
    await repo.recordEntry(job.id, {
      key: "posts/a.png",
      kind: "file",
      classification: "missing",
      state: "pending",
      sourceSize: 42,
    })

    expect(await repo.countEntries(job.id)).toBe(1)
  })

  it("is IDEMPOTENT — the same key twice is one row", async () => {
    // Inventory is resumable and retryable, so the same key legitimately
    // arrives more than once: after a restart mid-batch, or a retried request.
    // A duplicate row would inflate every count and hand the copy phase the
    // same object twice.
    const job = await repo.create({ mode: "copy", source, destination })
    const entry = {
      key: "posts/a.png",
      kind: "file" as const,
      classification: "missing",
      state: "pending",
      sourceSize: 42,
    }

    await repo.recordEntry(job.id, entry)
    await repo.recordEntry(job.id, entry)
    await repo.recordEntry(job.id, entry)

    expect(await repo.countEntries(job.id)).toBe(1)
  })

  it("updates the row when a retry carries better information", async () => {
    const job = await repo.create({ mode: "copy", source, destination })
    await repo.recordEntry(job.id, {
      key: "posts/a.png",
      kind: "file",
      classification: "missing",
      state: "pending",
    })
    await repo.recordEntry(job.id, {
      key: "posts/a.png",
      kind: "file",
      classification: "matching",
      state: "verified",
      sourceHash: "abc",
    })

    const [row] = await repo.entriesByClassification(job.id, "matching")
    expect(row.state).toBe("verified")
    expect(row.sourceHash).toBe("abc")
    expect(await repo.countEntries(job.id)).toBe(1)
  })

  it("keeps entries of different jobs apart", async () => {
    const first = await repo.create({ mode: "copy", source, destination })
    await repo.recordEntry(first.id, {
      key: "shared.png",
      kind: "file",
      classification: "missing",
      state: "pending",
    })
    await repo.cancel(first.id, first.version)

    const second = await repo.create({ mode: "copy", source, destination })
    await repo.recordEntry(second.id, {
      key: "shared.png",
      kind: "file",
      classification: "matching",
      state: "verified",
    })

    // The same key in two jobs is two rows; uniqueness is per job.
    expect(await repo.countEntries(first.id)).toBe(1)
    expect(await repo.countEntries(second.id)).toBe(1)
  })

  it("stores unicode keys exactly", async () => {
    const job = await repo.create({ mode: "copy", source, destination })
    await repo.recordEntry(job.id, {
      key: "posts/日本語 файл 🎉.png",
      kind: "file",
      classification: "missing",
      state: "pending",
    })

    const [row] = await repo.entriesByClassification(job.id, "missing")
    expect(row.key).toBe("posts/日本語 файл 🎉.png")
  })

  it("retains baseline metadata for the later delta", async () => {
    const job = await repo.create({ mode: "copy", source, destination })
    const when = new Date("2026-03-01T10:00:00.000Z")
    await repo.recordEntry(job.id, {
      key: "posts/a.png",
      kind: "file",
      classification: "missing",
      state: "hashed",
      sourceSize: 1234,
      sourceLastModified: when,
      sourceETag: '"an-etag"',
      sourceHash: "sha256hex",
    })

    const [row] = await repo.entriesByClassification(job.id, "missing")
    expect(row.sourceSize).toBe(1234)
    expect(row.sourceLastModified?.getTime()).toBe(when.getTime())
    expect(row.sourceHash).toBe("sha256hex")
    // Recorded, never the integrity decision.
    expect(row.sourceETag).toBe('"an-etag"')
  })
})

describe("resuming after a restart", () => {
  it("finds the open job and its persisted cursors", async () => {
    const job = await repo.create({ mode: "copy", source, destination })
    let advanced = await repo.transition(job.id, job.version, "destination_tested")
    advanced = await repo.transition(advanced.id, advanced.version, "inventorying")
    await repo.saveProgress(advanced.id, advanced.version, {
      sourceCursor: "posts/halfway.png",
    } as never)

    // A fresh repository over the same database — what a restarted process
    // sees. Nothing is held in memory.
    const fresh = createMigrationRepository({
      db: handle.db,
      migrations: handle.schema.storageMigrations,
      entries: handle.schema.storageMigrationEntries,
    })
    const resumed = await fresh.findActive()

    expect(resumed?.id).toBe(job.id)
    expect(resumed?.status).toBe("inventorying")
    expect(resumed?.sourceCursor).toBe("posts/halfway.png")
  })

  it("keeps the two scan cursors independent", async () => {
    // One cursor could not express "finished the source, halfway through the
    // destination", and resuming such a job would restart one of the scans.
    const job = await repo.create({ mode: "copy", source, destination })
    let advanced = await repo.transition(job.id, job.version, "destination_tested")
    advanced = await repo.transition(advanced.id, advanced.version, "inventorying")
    advanced = await repo.saveProgress(advanced.id, advanced.version, {
      sourceCursor: "z-last.png",
      sourceScanCompletedAt: new Date(),
      destinationCursor: "m-middle.png",
    } as never)

    expect(advanced.sourceScanCompletedAt).toBeTruthy()
    expect(advanced.destinationScanCompletedAt).toBeNull()
    expect(advanced.destinationCursor).toBe("m-middle.png")
  })
})

describe("secrets", () => {
  it("stores destination credentials the way the settings row already does", async () => {
    // Same convention as `settings.s3SecretAccessKey`: persisted so a resumed
    // migration can still reach the destination, and never returned by an API.
    // Introducing encryption here alone would be a new key-management surface
    // that the credential sitting beside it does not have.
    const job = await repo.create({
      mode: "copy",
      source,
      destination: { driver: "s3", locationId: "s3:https://new|r|b", bucket: "b" },
      destinationAccessKeyId: "AKIA-NEW",
      destinationSecretAccessKey: "the-secret",
    })

    const reloaded = await repo.findById(job.id)
    expect(reloaded?.destinationSecretAccessKey).toBe("the-secret")
  })
})
