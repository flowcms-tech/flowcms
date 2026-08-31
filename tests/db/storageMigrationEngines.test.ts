import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { afterAll, describe, expect, it } from "vitest"
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

describe("coverage of this axis", () => {
  it("reports which engines actually ran", () => {
    // Printed rather than asserted: with no URLs supplied, nothing above runs,
    // and a report that did not say so would read like evidence it had.
    const names = AVAILABLE.map((e) => e.name)
    console.log(
      names.length
        ? `[storage-migration] engine coverage: ${names.join(", ")}`
        : "[storage-migration] engine coverage: NONE — set TEST_POSTGRES_URL / TEST_MYSQL_URL / TEST_MARIADB_URL",
    )
    expect(Array.isArray(names)).toBe(true)
  })
})
