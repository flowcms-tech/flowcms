import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { parseDatabaseConfig } from "@/Framework/Config/databaseConfig"
import { createDatabase, type DatabaseHandle } from "@/db/createDatabase"
import {
  advanceInventory,
  normalizeKeyForDestination,
} from "@/Framework/Storage/Migration/inventory"
import { createMigrationRepository } from "@/Framework/Storage/Migration/migrationRepository"
import { createLocalStorageDriver } from "@/Framework/Storage/drivers/LocalStorageDriver"
import type { StorageDriver } from "@/Framework/Storage/StorageDriver"

/**
 * ENUMERATING BOTH SIDES, AGAINST A REAL DATABASE AND REAL STORES.
 *
 * The properties worth proving here are all about INTERRUPTION, so nothing is
 * mocked: a fake repository would happily "resume" from a cursor it invented,
 * and a fake driver would enumerate in whatever order the test wanted rather
 * than the ascending-key order the cursor depends on.
 *
 * The one that matters most is the collision check. An in-memory scanner sees
 * only the batch it is running, so `Photo.png` in batch one and `photo.png` in
 * batch four would both pass — and on a case-insensitive destination the second
 * silently overwrites the first while the migration reports success. The test
 * below deliberately puts them in different batches.
 */

let workspace: string
let handle: DatabaseHandle
let repository: ReturnType<typeof createMigrationRepository>
let source: StorageDriver
let destination: StorageDriver
let stores: string

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-inventory-"))
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
  repository = createMigrationRepository({
    db: handle.db as never,
    migrations: handle.schema.storageMigrations as never,
    entries: handle.schema.storageMigrationEntries as never,
  })
}, 60_000)

afterAll(async () => {
  await handle?.close().catch(() => {})
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // Windows holds the file handle briefly.
  }
})

beforeEach(async () => {
  await handle.db.delete(handle.schema.storageMigrationEntries as never)
  await handle.db.delete(handle.schema.storageMigrations as never)

  stores = mkdtempSync(join(workspace, "stores-"))
  source = createLocalStorageDriver(join(stores, "src"))
  destination = createLocalStorageDriver(join(stores, "dst"))
})

const bytes = (s: string) => Buffer.from(s, "utf8")

/**
 * A source that yields exactly these keys.
 *
 * REQUIRED FOR THE COLLISION TESTS, and the reason is the point they are
 * making: this suite runs on Windows and macOS too, where the temporary
 * directory backing a real local source is itself case-insensitive — writing
 * `Photo.png` and then `photo.png` produces ONE file, so the colliding pair
 * could never be constructed. Only `scanEntries` is implemented because a key
 * the destination does not hold is classified without either side being read.
 */
function scanOnlySource(keys: string[]): StorageDriver {
  return {
    async *scanEntries(options?: { after?: string }) {
      for (const key of [...keys].sort()) {
        if (options?.after && key <= options.after) continue
        yield { key, kind: "file" as const, size: 4, lastModified: new Date(0) }
      }
    },
  } as unknown as StorageDriver
}


/** A job already past its destination test, ready to inventory. */
async function newJob(over: { mode?: "copy" | "verify"; destinationDriver?: string } = {}) {
  const created = await repository.create({
    mode: over.mode ?? "copy",
    source: { driver: "local", locationId: "local:/src" },
    destination: { driver: over.destinationDriver ?? "local", locationId: "local:/dst" },
  })
  const tested = await repository.transition(created.id, created.version, "destination_tested")
  return repository.transition(tested.id, tested.version, "inventorying", {
    inventoryStartedAt: new Date(),
  } as never)
}

/** Runs batches until the inventory reports itself complete. */
async function runInventory(id: string, batchSize: number, caseSensitivity: "sensitive" | "insensitive" | null = "sensitive") {
  let rounds = 0
  for (;;) {
    const job = (await repository.findById(id))!
    const result = await advanceInventory(
      job,
      { repository, source, destination, destinationCaseSensitivity: caseSensitivity },
      { batchSize },
    )
    rounds += 1
    if (result.complete || rounds > 200) return rounds
  }
}

describe("normalising a key the way the destination would", () => {
  it("changes nothing for an S3 destination", () => {
    // Three genuinely different objects on S3, and folding them would invent
    // collisions that do not exist.
    for (const key of ["Photo.png", "photo.png", "photo.png/"]) {
      expect(normalizeKeyForDestination(key, { driver: "s3", caseSensitivity: null })).toBe(key)
    }
  })

  it("drops a trailing slash for a filesystem destination", () => {
    // `foo/` and `foo` cannot both exist: one is a directory, the other a file.
    const shape = { driver: "local" as const, caseSensitivity: "sensitive" as const }
    expect(normalizeKeyForDestination("foo/", shape)).toBe("foo")
    expect(normalizeKeyForDestination("foo", shape)).toBe("foo")
  })

  it("folds case only when the filesystem is case-insensitive", () => {
    expect(
      normalizeKeyForDestination("Photo.PNG", { driver: "local", caseSensitivity: "insensitive" }),
    ).toBe("photo.png")
    expect(
      normalizeKeyForDestination("Photo.PNG", { driver: "local", caseSensitivity: "sensitive" }),
    ).toBe("Photo.PNG")
  })
})

describe("enumerating both sides", () => {
  it("records every source entry", async () => {
    await source.uploadObject("a.txt", bytes("a"))
    await source.uploadObject("b.txt", bytes("b"))
    const job = await newJob()

    await runInventory(job.id, 50)

    expect(await repository.countEntries(job.id)).toBe(2)
    const byClassification = await repository.countByClassification(job.id)
    expect(byClassification.missing).toBe(2)
  })

  it("records an empty folder, which has no files to imply it", async () => {
    await source.createDirectory("empty/")
    const job = await newJob()

    await runInventory(job.id, 50)

    const entry = await repository.findEntry(job.id, "empty/")
    expect(entry?.kind).toBe("directory")
  })

  it("sees identical content on both sides as matching, by hash", async () => {
    await source.uploadObject("same.txt", bytes("identical"))
    await destination.uploadObject("same.txt", bytes("identical"))
    const job = await newJob()

    await runInventory(job.id, 50)

    expect((await repository.countByClassification(job.id)).matching).toBe(1)
  })

  it("sees a same-size, different-content file as conflicting", async () => {
    // The case every cheap check calls a match.
    await source.uploadObject("x.txt", bytes("aaaa"))
    await destination.uploadObject("x.txt", bytes("bbbb"))
    const job = await newJob()

    await runInventory(job.id, 50)

    const entry = await repository.findEntry(job.id, "x.txt")
    expect(entry?.classification).toBe("conflicting")
    expect(entry?.detail).toMatch(/same size/i)
  })

  it("reports a destination object the source does not have, without deleting it", async () => {
    await destination.uploadObject("theirs.txt", bytes("not ours"))
    const job = await newJob()

    await runInventory(job.id, 50)

    expect((await repository.countByClassification(job.id)).destination_only).toBe(1)
    // Still there. Reported, never removed.
    expect((await destination.downloadObject("theirs.txt")).toString()).toBe("not ours")
  })
})

describe("resumability", () => {
  it("reaches the same result in batches of one as in a single batch", async () => {
    for (let i = 0; i < 7; i += 1) await source.uploadObject(`f-${i}.txt`, bytes(`v${i}`))
    await destination.uploadObject("f-0.txt", bytes("v0"))

    const jobA = await newJob()
    await runInventory(jobA.id, 100)
    const inOneGo = await repository.countByClassification(jobA.id)

    await handle.db.delete(handle.schema.storageMigrationEntries as never)
    await handle.db.delete(handle.schema.storageMigrations as never)

    const jobB = await newJob()
    await runInventory(jobB.id, 1)
    const inBatches = await repository.countByClassification(jobB.id)

    expect(inBatches).toEqual(inOneGo)
  })

  it("persists a cursor so a later batch starts where the last stopped", async () => {
    for (let i = 0; i < 5; i += 1) await source.uploadObject(`f-${i}.txt`, bytes("x"))
    const job = await newJob()

    // Destination is empty, so its scan finishes on the first call.
    await advanceInventory(
      job,
      { repository, source, destination, destinationCaseSensitivity: "sensitive" },
      { batchSize: 2 },
    )
    const afterDestination = (await repository.findById(job.id))!
    const first = await advanceInventory(
      afterDestination,
      { repository, source, destination, destinationCaseSensitivity: "sensitive" },
      { batchSize: 2 },
    )

    expect(first.phase).toBe("source")
    expect(first.cursor).toBe("f-1.txt")
    expect(first.complete).toBe(false)
    expect(await repository.countEntries(job.id)).toBe(2)
  })

  it("clears a leftover row for a key the source no longer has", async () => {
    // A re-run must not leave behind work for a file that has since been
    // deleted: it would sit as unprocessed and block readiness forever.
    await source.uploadObject("stays.txt", bytes("a"))
    await source.uploadObject("goes.txt", bytes("b"))
    const job = await newJob()
    await runInventory(job.id, 50)
    expect(await repository.countEntries(job.id)).toBe(2)

    await source.deleteObject("goes.txt")
    const reinventoried = await repository.transition(
      job.id,
      (await repository.findById(job.id))!.version,
      "inventorying",
      {
        sourceCursor: null,
        sourceScanCompletedAt: null,
        destinationCursor: null,
        destinationScanCompletedAt: null,
        inventoryStartedAt: new Date(Date.now() + 5),
      } as never,
    )
    await runInventory(reinventoried.id, 50)

    expect(await repository.findEntry(job.id, "goes.txt")).toBeNull()
    expect(await repository.findEntry(job.id, "stays.txt")).not.toBeNull()
  })

  it("keeps a leftover row it OWNS, as something to reconcile", async () => {
    // Deleting this row would lose the ownership flag, and with it the only
    // licence the migration has to remove the copy it wrote.
    await source.uploadObject("ours.txt", bytes("a"))
    const job = await newJob()
    await runInventory(job.id, 50)
    await repository.saveOutcome(job.id, "ours.txt", {
      state: "verified",
      createdByMigration: true,
    })

    await source.deleteObject("ours.txt")
    const again = await repository.transition(
      job.id,
      (await repository.findById(job.id))!.version,
      "inventorying",
      {
        sourceCursor: null,
        sourceScanCompletedAt: null,
        destinationCursor: null,
        destinationScanCompletedAt: null,
        inventoryStartedAt: new Date(Date.now() + 5),
      } as never,
    )
    await runInventory(again.id, 50)

    const entry = await repository.findEntry(job.id, "ours.txt")
    expect(entry).not.toBeNull()
    expect(entry?.state).toBe("source_deleted")
    expect(entry?.createdByMigration).toBe(true)
  })
})

describe("keys the destination cannot represent", () => {
  it("blocks a Windows reserved device name", async () => {
    await source.uploadObject("con.txt", bytes("x"))
    const job = await newJob()

    await runInventory(job.id, 50)

    const entry = await repository.findEntry(job.id, "con.txt")
    expect(entry?.classification).toBe("incompatible")
    expect(entry?.detail).toMatch(/reserved device name/i)
  })

  it("blocks a trailing dot, which Windows silently removes", async () => {
    await source.uploadObject("name..txt", bytes("x"))
    await source.uploadObject("weird./file.txt", bytes("x"))
    const job = await newJob()

    await runInventory(job.id, 50)

    expect((await repository.findEntry(job.id, "weird./file.txt"))?.classification).toBe(
      "incompatible",
    )
  })

  it("does NOT apply filesystem rules to an S3 destination", async () => {
    // `con.txt` is a perfectly ordinary S3 key. Refusing it because Windows
    // would struggle would block a migration between two object stores for no
    // reason at all.
    await source.uploadObject("con.txt", bytes("x"))
    const job = await newJob({ destinationDriver: "s3" })

    await runInventory(job.id, 50, null)

    expect((await repository.findEntry(job.id, "con.txt"))?.classification).toBe("missing")
  })
})

describe("collisions across batch boundaries", () => {
  it("catches two keys that would become one file, batches apart", async () => {
    // THE TEST THIS MODULE EXISTS FOR. An in-memory scanner sees one batch;
    // these two keys are deliberately four apart, and on a case-insensitive
    // destination the second would overwrite the first while the migration
    // reported success.
    source = scanOnlySource(["Photo.png", "a.txt", "b.txt", "c.txt", "photo.png"])
    const job = await newJob()

    await runInventory(job.id, 1, "insensitive")

    expect((await repository.findEntry(job.id, "photo.png"))?.classification).toBe("incompatible")
  })

  it("marks BOTH sides of the collision, so the operator can act", async () => {
    source = scanOnlySource(["Photo.png", "a.txt", "photo.png"])
    const job = await newJob()

    await runInventory(job.id, 1, "insensitive")

    const first = await repository.findEntry(job.id, "Photo.png")
    const second = await repository.findEntry(job.id, "photo.png")
    expect(first?.classification).toBe("incompatible")
    expect(second?.classification).toBe("incompatible")
    // And each one names the other.
    expect(first?.detail).toContain("photo.png")
    expect(second?.detail).toContain("Photo.png")
  })

  it("never renames either key", async () => {
    source = scanOnlySource(["Photo.png", "photo.png"])
    const job = await newJob()

    await runInventory(job.id, 1, "insensitive")

    const detail = (await repository.findEntry(job.id, "photo.png"))?.detail ?? ""
    expect(detail).toMatch(/will not rename/i)
    // The keys are referenced by published content; rewriting one breaks every
    // link to it, so BOTH survive as their original selves.
    expect(await repository.findEntry(job.id, "Photo.png")).not.toBeNull()
    expect(await repository.findEntry(job.id, "photo.png")).not.toBeNull()
  })

  it("finds no collision when the destination filesystem is case-sensitive", async () => {
    source = scanOnlySource(["Photo.png", "photo.png"])
    const job = await newJob()

    await runInventory(job.id, 1, "sensitive")

    expect((await repository.findEntry(job.id, "photo.png"))?.classification).toBe("missing")
  })

  it("does not mistake a destination-only row for a colliding source key", async () => {
    // The destination scan records every destination key first. One of them
    // sharing a normalised form with a source key is not a collision — it is
    // the same file, and the classifier decides what it is.
    await source.uploadObject("photo.png", bytes("same"))
    await destination.uploadObject("photo.png", bytes("same"))
    const job = await newJob()

    await runInventory(job.id, 1, "insensitive")

    expect((await repository.findEntry(job.id, "photo.png"))?.classification).toBe("matching")
  })
})
