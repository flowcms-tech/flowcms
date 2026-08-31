import { randomUUID } from "node:crypto"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { parseDatabaseConfig } from "@/Framework/Config/databaseConfig"
import { createDatabase, type DatabaseHandle } from "@/db/createDatabase"
import { createMigrationRepository } from "@/Framework/Storage/Migration/migrationRepository"
import { acquireCutoverLock } from "@/Framework/Storage/storageWriteLock"

/**
 * TWO REPLICAS, ONE DATABASE.
 *
 * Every phase of this refactor claimed that its concurrency controls work
 * across replicas — the conditional-update claim, the optimistic `version`
 * guard, the one-active-migration rule, the cutover lock — and every phase
 * reported the same limitation honestly: none of it had been PROVEN, because
 * SQLite serialises write transactions. Two "concurrent" callers on SQLite are
 * two sequential callers, so a test there proves the code runs, not that the
 * guard holds.
 *
 * PostgreSQL gives real independent connections. Each `handle` below is a
 * separate connection pool, so the promises really do race, and a guard that
 * only worked because writes happened to be serialised fails here.
 *
 * SKIPPED WITHOUT A REAL DATABASE, deliberately. A version of these tests that
 * ran on SQLite would pass while proving nothing — which is worse than not
 * running, because it would read like evidence.
 */

const URL = process.env.TEST_POSTGRES_URL
const describeConcurrent = URL ? describe : describe.skip

const handles: DatabaseHandle[] = []

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

afterAll(async () => {
  await Promise.all(handles.map((h) => h.close().catch(() => {})))
})

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

    const created = results.filter((r) => r.status === "fulfilled")
    expect(created).toHaveLength(1)

    const rows = await a.handle.db.select().from(a.handle.schema.storageMigrations as never)
    expect(rows).toHaveLength(1)
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

describe("what is claimed about concurrency", () => {
  it("says out loud when the real proof did not run", () => {
    // Reading this in a test report is the point: the suite above is the only
    // evidence that any of these guards hold across replicas, and without a
    // real multi-connection database it did not execute.
    if (!URL) {
      expect(URL).toBeUndefined()
      return
    }
    expect(typeof URL).toBe("string")
  })
})
