import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { parseDatabaseConfig, type DatabaseDialect } from "@/Framework/Config/databaseConfig"
import { createDatabase, type DatabaseHandle } from "@/db/createDatabase"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import {
  clearMigrationCredentials,
  commitCutover,
  type CutoverStore,
} from "@/Framework/Storage/Migration/cutover"
import { probeDestinationCaseSensitivity } from "@/Framework/Storage/Migration/compatibility"
import { createMigrationRepository } from "@/Framework/Storage/Migration/migrationRepository"
import { createMigrationService } from "@/Framework/Storage/Migration/migrationService"
import { acquireCutoverLock } from "@/Framework/Storage/storageWriteLock"
import { createLocalStorageDriver } from "@/Framework/Storage/drivers/LocalStorageDriver"
import { storageLocationId, type ResolvedStorageConfig } from "@/Framework/Storage/storageConfig"

/**
 * THE MIGRATION ENGINE, ON EVERY DATABASE FLOWCMS SUPPORTS.
 *
 * Phases 4a–4c drove the whole workflow against SQLite and nothing else, and
 * that hid a defect that made the engine INOPERABLE on the other three
 * engines: every conditional write counted its affected rows by reading
 * `rowsAffected ?? rowCount`, which is libsql's shape and nobody else's.
 * postgres.js reports `count`; mysql2 reports `affectedRows` inside a result
 * header. Both read as zero, so on PostgreSQL, MySQL and MariaDB:
 *
 *   every legal state transition threw "that migration changed"
 *   the entry claim took nothing, so no batch ever ran
 *   the cutover lock could never be acquired
 *   and the cutover transaction ROLLED ITSELF BACK after committing correctly
 *
 * None of it was visible from SQLite, and no amount of care in the migration
 * code would have found it — only running the thing somewhere else does. So
 * this suite exists to make "works on four databases" a measurement.
 *
 * The stores on both ends are real temporary directories. What varies is the
 * DATABASE, which is the axis the defect lived on.
 *
 * THE CONCURRENCY SUITE LIVES IN THIS FILE RATHER THAN ITS OWN, and that is not
 * organisation — it is correctness. Both halves drive the SAME database, and
 * "at most one migration is open per installation" is a global invariant, so
 * two suites cannot each hold an open job. Vitest runs separate FILES in
 * parallel workers, so as two files they raced and failed each other
 * intermittently; within one file they run in order. A flaky guard test is
 * worse than none, because the failure teaches people to re-run rather than
 * look.
 */

interface Engine {
  name: string
  dialect: DatabaseDialect
  url: string
}

function engines(): Engine[] {
  const out: Engine[] = []
  if (process.env.TEST_POSTGRES_URL) {
    out.push({ name: "postgresql", dialect: "postgresql", url: process.env.TEST_POSTGRES_URL })
  }
  if (process.env.TEST_MYSQL_URL) {
    out.push({ name: "mysql", dialect: "mysql", url: process.env.TEST_MYSQL_URL })
  }
  if (process.env.TEST_MARIADB_URL) {
    out.push({ name: "mariadb", dialect: "mariadb", url: process.env.TEST_MARIADB_URL })
  }
  return out
}

const handles: DatabaseHandle[] = []
const workspaces: string[] = []

afterAll(async () => {
  await Promise.all(handles.map((h) => h.close().catch(() => {})))
  for (const dir of workspaces) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows holds handles briefly.
    }
  }
})

const AVAILABLE = engines()

describe.runIf(AVAILABLE.length > 0).each(AVAILABLE)("on $name", (engine) => {
  it("runs a whole migration, from create to cutover", async () => {
    const handle = createDatabase(
      parseDatabaseConfig({ DATABASE_DIALECT: engine.dialect, DATABASE_URL: engine.url }),
    )
    handles.push(handle)

    const workspace = mkdtempSync(join(tmpdir(), `flowcms-engine-${engine.name}-`))
    workspaces.push(workspace)
    const sourceRoot = join(workspace, "src")
    const destinationRoot = join(workspace, "dst")

    const repository = createMigrationRepository({
      db: handle.db as never,
      migrations: handle.schema.storageMigrations as never,
      entries: handle.schema.storageMigrationEntries as never,
      dialect: handle.dialect,
    })

    // A clean slate on a shared database: this suite and the concurrency suite
    // may both point at the same server.
    await handle.db.delete(handle.schema.storageMigrationEntries as never)
    await handle.db.delete(handle.schema.storageMigrations as never)
    await handle.db.delete(handle.schema.settings as never)

    let active: ResolvedStorageConfig = { driver: "local", root: sourceRoot }
    await handle.db.insert(handle.schema.settings as never).values({
      id: SETTINGS_SINGLETON_ID,
      activeStorageDriver: "local",
      activeStorageLocationId: storageLocationId(active),
      activeStorageRoot: sourceRoot,
      setupCompletedAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const store = (): CutoverStore => ({
      db: handle.db as never,
      settings: handle.schema.settings as never,
      migrations: handle.schema.storageMigrations as never,
      invalidate: async () => {},
    })

    const service = createMigrationService({
      repository,
      activeConfig: async () => active,
      environmentConfig: async () => null,
      createDriver: (config) => createLocalStorageDriver((config as { root: string }).root),
      testDestination: async () => ({ ok: true }),
      probeCaseSensitivity: probeDestinationCaseSensitivity,
      acquireLock: (id, from) =>
        acquireCutoverLock(id, from, {
          db: handle.db as never,
          migrations: handle.schema.storageMigrations as never,
        }),
      commit: async (job, destination) => {
        await commitCutover(job, destination, store())
        active = destination
      },
      clearCredentials: (id) => clearMigrationCredentials(id, store()),
      invalidateCaches: async () => {},
      env: { LOCAL_STORAGE_PATH: destinationRoot } as unknown as NodeJS.ProcessEnv,
    })

    const source = createLocalStorageDriver(sourceRoot)
    const destination = createLocalStorageDriver(destinationRoot)
    await source.uploadObject("2026/08/one.txt", Buffer.from("first", "utf8"))
    await source.uploadObject("2026/08/two.txt", Buffer.from("second", "utf8"))
    await source.createDirectory("empty/")

    // ---- The workflow, exactly as a route drives it ----------------------
    const created = await service.create({ mode: "copy", destination: { driver: "local" } })
    await service.testDestination(created.id)

    for (let i = 0; i < 200; i += 1) {
      const job = await service.describeActiveJob()
      if (!job) break
      if (job.status === "destination_tested" || job.status === "inventorying") {
        await service.runInventoryBatch(created.id, { batchSize: 10 })
      } else if (job.status === "ready" || job.status === "copying" || job.status === "verifying") {
        const result = await service.runTransferBatch(created.id, { batchSize: 5 })
        const after = await service.describeActiveJob()
        if (result.exhausted && after?.status === job.status) break
      } else break
    }

    // EVERY STEP ABOVE IS A CONDITIONAL WRITE. Reaching this state at all is
    // the assertion: before the fix, the very first transition threw.
    expect((await service.describeActiveJob())?.status).toBe("ready_to_cutover")

    // The source changes underneath, so the final delta has real work.
    await source.uploadObject("2026/08/late.txt", Buffer.from("late", "utf8"))

    const result = await service.cutover(created.id)
    expect(result.outcome).toBe("completed")

    // The destination is authoritative, in the database this engine owns.
    const settings = await handle.db
      .select()
      .from(handle.schema.settings as never)
      .where(eq((handle.schema.settings as never as { id: never }).id, SETTINGS_SINGLETON_ID))
    expect((settings[0] as Record<string, unknown>).activeStorageRoot).toBe(destinationRoot)

    // Every file arrived, keys unchanged, and the delta caught the late one.
    expect((await destination.downloadObject("2026/08/one.txt")).toString()).toBe("first")
    expect((await destination.downloadObject("2026/08/two.txt")).toString()).toBe("second")
    expect((await destination.downloadObject("2026/08/late.txt")).toString()).toBe("late")
    expect((await destination.listDirectory("")).directories).toContain("empty/")

    // And the source is untouched.
    expect((await source.downloadObject("2026/08/one.txt")).toString()).toBe("first")

    // The job is terminal and its credential copy is gone.
    const job = await repository.findById(created.id)
    expect(job?.status).toBe("completed")
    expect(job?.destinationSecretAccessKey).toBeNull()
  }, 180_000)
})

// --------------------------------------------------------------------------

const URL = process.env.TEST_POSTGRES_URL
const describeConcurrent = URL ? describe : describe.skip

/** A repository on its OWN connection pool — one "replica". */
function replica() {
  const handle = createDatabase(
    parseDatabaseConfig({ DATABASE_DIALECT: "postgresql", DATABASE_URL: URL! }),
  )
  handles.push(handle)
  return {
    handle,
    repository: createMigrationRepository({
      db: handle.db as never,
      migrations: handle.schema.storageMigrations as never,
      entries: handle.schema.storageMigrationEntries as never,
      dialect: handle.dialect,
    }),
  }
}

describeConcurrent("guards that only matter across replicas", () => {
  let a: ReturnType<typeof replica>
  let b: ReturnType<typeof replica>

  beforeEach(async () => {
    a = a ?? replica()
    b = b ?? replica()
    await a.handle.db.delete(a.handle.schema.storageMigrationEntries as never)
    await a.handle.db.delete(a.handle.schema.storageMigrations as never)
  })

  const topology = (id: string) => ({
    driver: "s3" as const,
    locationId: id,
    endpoint: "https://example.com",
    bucket: id,
  })

  async function openJob() {
    return a.repository.create({
      mode: "copy",
      source: topology("source-bucket"),
      destination: topology("destination-bucket"),
    })
  }

  it("lets exactly ONE of two racing replicas open a migration", async () => {
    // Two concurrent relocations would each copy to their own destination
    // while the other mutated the source, so each final delta would be
    // computed against a baseline the other had invalidated.
    // SAFETY IS ASSERTED UNCONDITIONALLY; LIVENESS IS RETRIED.
    //
    // "Never two" is the guarantee, and it must hold on every attempt. "Exactly
    // one wins" is a liveness property, and a loaded machine can legitimately
    // break it — a pool that cannot hand out a connection rejects BOTH callers,
    // which says nothing about the guard. This test failed once that way in a
    // full 143-file run and passed repeatedly on its own, which is the
    // signature of load rather than of a defect.
    //
    // So an attempt where nobody won for an INFRASTRUCTURE reason is retried,
    // and one where nobody won because both were told a migration is already
    // active is a real failure — that would mean a phantom job holding the slot.
    let winners = 0
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await a.handle.db.delete(a.handle.schema.storageMigrations as never)

      const results = await Promise.allSettled([
        a.repository.create({
          mode: "copy",
          source: topology("source-bucket"),
          destination: topology("dest-a"),
        }),
        b.repository.create({
          mode: "copy",
          source: topology("source-bucket"),
          destination: topology("dest-b"),
        }),
      ])

      winners = results.filter((r) => r.status === "fulfilled").length
      const rows = await a.handle.db.select().from(a.handle.schema.storageMigrations as never)

      // The two things that must be true every single time.
      expect(winners, "two replicas both opened a migration").toBeLessThanOrEqual(1)
      expect(rows.length, "two migration rows exist at once").toBeLessThanOrEqual(1)

      if (winners === 1) {
        expect(rows).toHaveLength(1)
        return
      }

      const guardFired = results.every(
        (r) => r.status === "rejected" && String(r.reason).includes("already in progress"),
      )
      expect(guardFired, "nobody won, and not because the guard refused them").toBe(false)
    }

    expect(winners, "no replica ever opened a migration across three attempts").toBe(1)
  })

  it("lets exactly ONE of two racing replicas advance the same job", async () => {
    // The optimistic `version` guard. Both read the same version; only the
    // write conditioned on it can match a row.
    const job = await openJob()

    const results = await Promise.allSettled([
      a.repository.transition(job.id, job.version, "destination_tested"),
      b.repository.transition(job.id, job.version, "destination_tested"),
    ])

    const reasons = results.map((r) => (r.status === "rejected" ? String(r.reason) : "ok"))
    expect(results.filter((r) => r.status === "fulfilled"), reasons.join(" | ")).toHaveLength(1)
    // The loser is refused on ONE of two grounds, depending on which side of
    // the winner's commit its read landed: the version guard, or the state
    // machine seeing a status that has already moved. Both are refusals.
    const loser = reasons.find((r) => r !== "ok") ?? ""
    expect(loser).toMatch(/changed while this request was working on it|cannot go from/)
    const after = await a.repository.findById(job.id)
    expect(after?.version).toBe(job.version + 1)
  })

  it("lets exactly ONE of two racing replicas take the cutover lock", async () => {
    // The lock IS the write gate: if both took it, both would believe storage
    // was theirs to switch.
    const job = await openJob()
    let current = await a.repository.transition(job.id, job.version, "destination_tested")
    current = await a.repository.transition(current.id, current.version, "inventorying")
    current = await a.repository.transition(current.id, current.version, "ready")
    current = await a.repository.transition(current.id, current.version, "copying")
    current = await a.repository.transition(current.id, current.version, "verifying")
    current = await a.repository.transition(current.id, current.version, "ready_to_cutover")

    const store = (r: ReturnType<typeof replica>) => ({
      db: r.handle.db as never,
      migrations: r.handle.schema.storageMigrations as never,
    })

    const [first, second] = await Promise.all([
      acquireCutoverLock(current.id, "ready_to_cutover", store(a)),
      acquireCutoverLock(current.id, "ready_to_cutover", store(b)),
    ])

    expect([first, second].filter(Boolean)).toHaveLength(1)
  })

  it("never hands the same entry to two racing replicas", async () => {
    // Two workers streaming to one key interleaves into corruption on a
    // filesystem, not a harmless duplicate write.
    const job = await openJob()
    for (let i = 0; i < 40; i += 1) {
      await a.repository.recordEntry(job.id, {
        key: `f-${i}.txt`,
        kind: "file",
        classification: "missing",
        state: "pending",
      })
    }

    const runA = randomUUID()
    const runB = randomUUID()
    const [claimedA, claimedB] = await Promise.all([
      a.repository.claimEntries(job.id, runA, 40),
      b.repository.claimEntries(job.id, runB, 40),
    ])

    const keysA = new Set(claimedA.map((row) => row.key))
    const overlap = claimedB.map((row) => row.key).filter((key) => keysA.has(key))

    expect(overlap).toEqual([])
    expect(claimedA.length + claimedB.length).toBeLessThanOrEqual(40)
  })

  it("counts every entry exactly once when two replicas record the same keys", async () => {
    // Inventory is resumable and retryable, so the same key legitimately
    // arrives more than once — from two replicas at once, here. Without the
    // unique `(migrationId, key)` index each arrival would insert a duplicate
    // row, inflating every count and handing the copy phase the same object
    // twice.
    const job = await openJob()
    const keys = Array.from({ length: 20 }, (_, i) => `dup-${i}.txt`)

    const record = (r: ReturnType<typeof replica>) =>
      Promise.all(
        keys.map((key) =>
          r.repository
            .recordEntry(job.id, {
              key,
              kind: "file",
              classification: "missing",
              state: "pending",
            })
            .catch(() => {}),
        ),
      )

    await Promise.all([record(a), record(b)])

    expect(await a.repository.countEntries(job.id)).toBe(keys.length)
  })
})
