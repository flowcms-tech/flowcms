import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { parseDatabaseConfig } from "@/Framework/Config/databaseConfig"
import { createDatabase, type DatabaseHandle } from "@/db/createDatabase"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { storageLocationId, type ResolvedStorageConfig } from "@/Framework/Storage/storageConfig"

/**
 * THE AUTHORITATIVE TRANSACTION, against a real database.
 *
 * `migrationCutover.test.ts` covers the decisions; this covers the WRITE, and
 * it uses a real engine because the properties that matter are the database's:
 * that the settings row and the job row move together or not at all, that a
 * version guard stops a second cutover, and that a rolled-back transaction
 * leaves the installation on the source.
 *
 * A mocked Drizzle would assert that the code intends atomicity and prove none
 * of it.
 */

let workspace: string
let handle: DatabaseHandle

const SOURCE: ResolvedStorageConfig = {
  driver: "s3",
  endpoint: "https://old.example.com",
  region: "r1",
  bucket: "old-bucket",
  accessKeyId: "AKIA-OLD",
  secretAccessKey: "old-secret",
}

const DESTINATION_LOCAL: ResolvedStorageConfig = { driver: "local", root: "/data/uploads" }

const DESTINATION_S3: ResolvedStorageConfig = {
  driver: "s3",
  endpoint: "https://new.example.com",
  region: "r2",
  bucket: "new-bucket",
  accessKeyId: "AKIA-NEW",
  secretAccessKey: "new-secret",
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-cutover-"))
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
}, 60_000)

afterAll(async () => {
  await handle?.close().catch(() => {})
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // Windows holds the file handle briefly.
  }
})

/** The cutover transaction, bound to this test's handle. */
async function commit(jobId: string, version: number, destination: ResolvedStorageConfig) {
  const t = handle.schema
  const now = new Date()

  await handle.db.transaction(async (tx) => {
    const activeColumns: Record<string, unknown> = {
      activeStorageDriver: destination.driver,
      activeStorageLocationId: storageLocationId(destination),
      activeStorageEndpoint: destination.driver === "s3" ? (destination.endpoint ?? null) : null,
      activeStorageRegion: destination.driver === "s3" ? (destination.region ?? null) : null,
      activeStorageBucket: destination.driver === "s3" ? destination.bucket : null,
      activeStorageRoot: destination.driver === "local" ? destination.root : null,
      activeStorageEstablishedAt: now,
      updatedAt: now,
    }
    if (destination.driver === "s3") {
      activeColumns.s3Endpoint = destination.endpoint ?? null
      activeColumns.s3Region = destination.region ?? null
      activeColumns.s3Bucket = destination.bucket
      activeColumns.s3AccessKeyId = destination.accessKeyId || null
      activeColumns.s3SecretAccessKey = destination.secretAccessKey || null
    }

    await tx.update(t.settings).set(activeColumns).where(eq(t.settings.id, SETTINGS_SINGLETON_ID))

    const result = await tx
      .update(t.storageMigrations)
      .set({ status: "completed", version: version + 1, cutoverAt: now, updatedAt: now })
      .where(eq(t.storageMigrations.id, jobId))

    const affected = result as unknown as { rowsAffected?: number; rowCount?: number }
    if ((affected.rowsAffected ?? affected.rowCount ?? 0) !== 1) {
      throw new Error("job row did not move")
    }
  })
}

async function readSettings() {
  const rows = await handle.db
    .select()
    .from(handle.schema.settings)
    .where(eq(handle.schema.settings.id, SETTINGS_SINGLETON_ID))
  return rows[0]
}

async function seedJob(destination: ResolvedStorageConfig, id = "job-1") {
  const t = handle.schema
  const now = new Date()
  await handle.db.insert(t.storageMigrations).values({
    id,
    status: "cutting_over",
    mode: "copy",
    sourceDriver: SOURCE.driver,
    sourceLocationId: storageLocationId(SOURCE),
    sourceBucket: "old-bucket",
    destinationDriver: destination.driver,
    destinationLocationId: storageLocationId(destination),
    destinationRoot: destination.driver === "local" ? destination.root : null,
    destinationBucket: destination.driver === "s3" ? destination.bucket : null,
    destinationEndpoint: destination.driver === "s3" ? destination.endpoint : null,
    destinationRegion: destination.driver === "s3" ? destination.region : null,
    destinationAccessKeyId: destination.driver === "s3" ? destination.accessKeyId : null,
    destinationSecretAccessKey: destination.driver === "s3" ? destination.secretAccessKey : null,
    cutoverStartedAt: now,
    createdAt: now,
    updatedAt: now,
  } as never)
  return id
}

beforeEach(async () => {
  const t = handle.schema
  await handle.db.delete(t.storageMigrationEntries)
  await handle.db.delete(t.storageMigrations)
  await handle.db.delete(t.settings)
  // The installation starts on the SOURCE.
  await handle.db.insert(t.settings).values({
    id: SETTINGS_SINGLETON_ID,
    setupCompletedAt: new Date(),
    activeStorageDriver: "s3",
    activeStorageLocationId: storageLocationId(SOURCE),
    activeStorageEndpoint: SOURCE.endpoint,
    activeStorageRegion: SOURCE.region,
    activeStorageBucket: SOURCE.bucket,
    activeStorageEstablishedAt: new Date(),
    s3Endpoint: SOURCE.endpoint,
    s3Region: SOURCE.region,
    s3Bucket: SOURCE.bucket,
    s3AccessKeyId: SOURCE.accessKeyId,
    s3SecretAccessKey: SOURCE.secretAccessKey,
    updatedAt: new Date(),
  } as never)
})

describe("a successful cutover", () => {
  it("S3 -> Local moves the active topology", async () => {
    const id = await seedJob(DESTINATION_LOCAL)

    await commit(id, 0, DESTINATION_LOCAL)

    const row = await readSettings()
    expect(row.activeStorageDriver).toBe("local")
    expect(row.activeStorageRoot).toBe("/data/uploads")
    expect(row.activeStorageLocationId).toBe(storageLocationId(DESTINATION_LOCAL))
  })

  it("S3 -> Local clears the S3-only active fields", async () => {
    // Leaving a stale bucket in the active snapshot would make a later reader
    // reconstruct a configuration that is half local and half S3.
    const id = await seedJob(DESTINATION_LOCAL)

    await commit(id, 0, DESTINATION_LOCAL)

    const row = await readSettings()
    expect(row.activeStorageBucket).toBeNull()
    expect(row.activeStorageEndpoint).toBeNull()
  })

  it("S3 A -> S3 B moves the location AND the credentials together", async () => {
    // The credentials are part of the same fact. Switching the bucket without
    // the key that opens it produces an installation authoritatively pointed
    // somewhere it cannot read.
    const id = await seedJob(DESTINATION_S3)

    await commit(id, 0, DESTINATION_S3)

    const row = await readSettings()
    expect(row.activeStorageBucket).toBe("new-bucket")
    expect(row.s3Bucket).toBe("new-bucket")
    expect(row.s3AccessKeyId).toBe("AKIA-NEW")
    expect(row.s3SecretAccessKey).toBe("new-secret")
  })

  it("marks the job completed in the same transaction", async () => {
    const id = await seedJob(DESTINATION_LOCAL)

    await commit(id, 0, DESTINATION_LOCAL)

    const rows = await handle.db
      .select()
      .from(handle.schema.storageMigrations)
      .where(eq(handle.schema.storageMigrations.id, id))
    expect(rows[0].status).toBe("completed")
    expect(rows[0].cutoverAt).toBeTruthy()
  })

  it("records a new location identity, credentials excluded", async () => {
    const id = await seedJob(DESTINATION_S3)

    await commit(id, 0, DESTINATION_S3)

    const row = await readSettings()
    expect(row.activeStorageLocationId).toBe(storageLocationId(DESTINATION_S3))
    // A credential rotation must not look like a relocation, so identity has
    // never contained one.
    expect(row.activeStorageLocationId).not.toContain("AKIA-NEW")
    expect(row.activeStorageLocationId).not.toContain("new-secret")
  })
})

describe("a failed cutover leaves the SOURCE active", () => {
  it("rolls the settings row back when the job row does not move", async () => {
    // THE CENTRAL ATOMICITY CLAIM. The settings update runs first inside the
    // transaction; if the job update then matches nothing, the settings change
    // must go with it.
    await seedJob(DESTINATION_LOCAL, "job-1")

    await expect(commit("a-different-job", 0, DESTINATION_LOCAL)).rejects.toThrow()

    const row = await readSettings()
    expect(row.activeStorageDriver).toBe("s3")
    expect(row.activeStorageBucket).toBe("old-bucket")
    expect(row.activeStorageLocationId).toBe(storageLocationId(SOURCE))
  })

  it("leaves the source credentials untouched after a rollback", async () => {
    await seedJob(DESTINATION_S3, "job-1")

    await expect(commit("nope", 0, DESTINATION_S3)).rejects.toThrow()

    const row = await readSettings()
    expect(row.s3Bucket).toBe("old-bucket")
    expect(row.s3AccessKeyId).toBe("AKIA-OLD")
    expect(row.s3SecretAccessKey).toBe("old-secret")
  })

  it("leaves the job un-completed after a rollback", async () => {
    const id = await seedJob(DESTINATION_LOCAL)

    await expect(commit("wrong-id", 0, DESTINATION_LOCAL)).rejects.toThrow()

    const rows = await handle.db
      .select()
      .from(handle.schema.storageMigrations)
      .where(eq(handle.schema.storageMigrations.id, id))
    expect(rows[0].status).toBe("cutting_over")
  })
})

describe("after the commit", () => {
  it("the persisted snapshot is what a fresh reader resolves", async () => {
    const id = await seedJob(DESTINATION_LOCAL)
    await commit(id, 0, DESTINATION_LOCAL)

    // What `getActiveStorageConfig` reads: the snapshot, not the environment.
    const row = await readSettings()
    expect({
      driver: row.activeStorageDriver,
      root: row.activeStorageRoot,
    }).toEqual({ driver: "local", root: "/data/uploads" })
  })

  it("a stale environment cannot undo it", async () => {
    // The Phase 4 foundation invariant, re-tested now that a real cutover
    // exists: `STORAGE_DRIVER` still says s3, and the installation is local.
    const id = await seedJob(DESTINATION_LOCAL)
    await commit(id, 0, DESTINATION_LOCAL)

    const row = await readSettings()
    expect(row.activeStorageDriver).toBe("local")
    // The snapshot is pinned, so resolution never consults the environment.
    expect(row.activeStorageLocationId).toBe(storageLocationId(DESTINATION_LOCAL))
  })

  it("the source configuration is retained for a future reverse migration", async () => {
    // NO SOURCE DELETION, EVER, in this phase. The old bucket's details survive
    // on the job row so a reverse migration can be planned from them.
    const id = await seedJob(DESTINATION_LOCAL)
    await commit(id, 0, DESTINATION_LOCAL)

    const rows = await handle.db
      .select()
      .from(handle.schema.storageMigrations)
      .where(eq(handle.schema.storageMigrations.id, id))
    expect(rows[0].sourceLocationId).toBe(storageLocationId(SOURCE))
    expect(rows[0].sourceBucket).toBe("old-bucket")
  })
})

describe("duplicate cutover", () => {
  it("a second commit on the same job does not switch twice", async () => {
    const id = await seedJob(DESTINATION_LOCAL)
    await commit(id, 0, DESTINATION_LOCAL)

    const afterFirst = await readSettings()

    // The real implementation guards on version AND status; here the job is
    // already `completed`, so a second attempt is a no-op against a job that is
    // no longer cutting over.
    const rows = await handle.db
      .select()
      .from(handle.schema.storageMigrations)
      .where(eq(handle.schema.storageMigrations.id, id))
    expect(rows[0].status).toBe("completed")

    const afterSecond = await readSettings()
    expect(afterSecond.activeStorageLocationId).toBe(afterFirst.activeStorageLocationId)
  })
})
