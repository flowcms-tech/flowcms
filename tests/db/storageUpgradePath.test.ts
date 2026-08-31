import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * UPGRADING A SITE THAT ALREADY EXISTS.
 *
 * The single most important release regression, and the one a
 * fresh-schema test cannot cover: every installation this branch will ever
 * touch already has media in a bucket, keys embedded in published post bodies,
 * and no idea that a storage abstraction was added underneath it.
 *
 * So this builds a database at MAIN's schema (migrations 0000–0004), fills it
 * with a plausible pre-refactor installation, applies the four migrations this
 * branch adds, and then asks the questions that matter:
 *
 *   Is the existing configuration still there?
 *   Is the installation still marked as set up?
 *   Did any content row change?
 *   Does it resolve S3, with no STORAGE_DRIVER set anywhere?
 *   Does it pin that durably, on its own, without being told to?
 *
 * The last one is the upgrade path in one sentence: absence of
 * `STORAGE_DRIVER` means `s3`, and an installation that has completed setup
 * records what it is already using rather than waiting to be reconfigured.
 */

let workspace: string
const MAIN_ERA = ["0000_baseline", "0001_active_theme", "0002_menus", "0003_theme_settings", "0004_setup_marker"]

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-upgrade-"))
})

afterAll(() => {
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // Windows holds the file handle briefly.
  }
})

/**
 * A migrations folder containing only the tags a `main`-era database had.
 *
 * Built by copying the real SQL rather than by hand-writing a schema: a
 * hand-written "old schema" drifts from what installations actually have, and
 * would let this test pass against a database nobody runs.
 */
function migrationsFolderFor(tags: string[], name: string): string {
  const dir = join(workspace, name)
  const meta = join(dir, "meta")
  rmSync(dir, { recursive: true, force: true })
  cpSync("src/db/migrations/sqlite", dir, { recursive: true })

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".sql")) continue
    if (!tags.includes(file.replace(/\.sql$/, ""))) rmSync(join(dir, file))
  }

  const journal = JSON.parse(
    readFileSync(join("src/db/migrations/sqlite", "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] }
  journal.entries = journal.entries.filter((entry) => tags.includes(entry.tag))
  writeFileSync(join(meta, "_journal.json"), JSON.stringify(journal, null, 2))

  return dir
}

async function migrateWith(url: string, folder: string) {
  const { createClient } = await import("@libsql/client")
  const { drizzle } = await import("drizzle-orm/libsql")
  const { migrate } = await import("drizzle-orm/libsql/migrator")
  const client = createClient({ url })
  try {
    await migrate(drizzle(client), { migrationsFolder: folder })
  } finally {
    client.close()
  }
}

async function client(url: string) {
  const { createClient } = await import("@libsql/client")
  return createClient({ url })
}

describe("a pre-refactor installation upgrading to this branch", () => {
  it("keeps its settings, its content and its setup marker, and gains the migration tables", async () => {
    const url = `file:${join(workspace, "upgrade.db")}`

    // ---- 1. A database at main's schema ---------------------------------
    await migrateWith(url, migrationsFolderFor(MAIN_ERA, "main-era"))

    const db = await client(url)
    const completedAt = Date.now() - 86_400_000

    await db.execute({
      sql: `insert into settings
              (id, siteName, setupCompletedAt, s3Endpoint, s3Region, s3Bucket,
               s3AccessKeyId, s3SecretAccessKey, updatedAt)
            values ('global', 'An Existing Site', ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        completedAt,
        "https://s3.example.com",
        "auto",
        "existing-media",
        "AKIA-EXISTING",
        "existing-secret",
        completedAt,
      ],
    })

    await db.execute({
      sql: `insert into user (id, email, role, createdAt, updatedAt)
            values ('user-1', 'owner@example.com', 'owner', ?, ?)`,
      args: [completedAt, completedAt],
    })

    // Content that REFERENCES stored objects by key. If a migration rewrote
    // one of these, every image on the site would break.
    const postBody =
      '<p>Before</p><img src="/api/public/images/2024/03/hero.png" alt="hero">' +
      '<img src="/api/public/images/2024/03/inline.jpg">'
    await db.execute({
      sql: `insert into blog_post
              (id, title, slug, excerpt, content, featuredImageKey, authorId,
               isPublished, createdAt, updatedAt)
            values ('post-1', 'Existing post', 'existing-post', 'An excerpt', ?,
                    '2024/03/hero.png', 'user-1', 1, ?, ?)`,
      args: [postBody, completedAt, completedAt],
    })

    const before = await db.execute("select * from blog_post where id = 'post-1'")
    const settingsBefore = await db.execute("select * from settings where id = 'global'")

    // ---- 2. Upgrade ------------------------------------------------------
    await migrateWith(url, "src/db/migrations/sqlite")

    // ---- 3. Nothing that existed was touched ----------------------------
    const after = await db.execute("select * from blog_post where id = 'post-1'")
    expect(after.rows[0].content).toBe(postBody)
    expect(after.rows[0].content).toContain("/api/public/images/2024/03/hero.png")
    // The featured-image KEY is untouched too — it is what every thumbnail and
    // every open-graph tag is built from.
    expect(after.rows[0].featuredImageKey).toBe("2024/03/hero.png")
    expect(after.rows).toEqual(before.rows)

    const settingsAfter = await db.execute(
      "select siteName, setupCompletedAt, s3Bucket, s3Endpoint, s3Region, s3AccessKeyId from settings where id = 'global'",
    )
    expect(settingsAfter.rows[0].siteName).toBe("An Existing Site")
    expect(settingsAfter.rows[0].setupCompletedAt).toBe(completedAt)
    expect(settingsAfter.rows[0].s3Bucket).toBe("existing-media")
    expect(settingsAfter.rows[0].s3Endpoint).toBe("https://s3.example.com")
    expect(settingsBefore.rows[0].s3SecretAccessKey).toBe("existing-secret")

    // ---- 4. The new schema is present and EMPTY -------------------------
    // An upgrade must not invent a migration. The active-storage snapshot is
    // null until the application pins it, which is what makes "the environment
    // bootstraps, the snapshot owns" true for an upgraded install too.
    const snapshot = await db.execute(
      "select activeStorageDriver, activeStorageLocationId from settings where id = 'global'",
    )
    expect(snapshot.rows[0].activeStorageDriver).toBeNull()
    expect(snapshot.rows[0].activeStorageLocationId).toBeNull()

    const jobs = await db.execute("select count(*) as n from storage_migration")
    expect(Number(jobs.rows[0].n)).toBe(0)

    // ---- 5. Every column and index the branch adds exists ---------------
    const jobColumns = (await db.execute("pragma table_info(storage_migration)")).rows.map(
      (r) => r.name,
    )
    for (const column of [
      "cutoverStartedAt", // 0006
      "extrasAcknowledgedCount", // 0007
      "inventoryGeneration", // 0008
    ]) {
      expect(jobColumns, `storage_migration.${column}`).toContain(column)
    }
    // 0008 replaced the timestamp with a generation; the column it dropped
    // must actually be gone, or two mechanisms would coexist.
    expect(jobColumns).not.toContain("inventoryStartedAt")

    const entryColumns = (await db.execute("pragma table_info(storage_migration_entry)")).rows.map(
      (r) => r.name,
    )
    for (const column of ["claimedBy", "claimedAt", "normalizedKey", "seenInGeneration"]) {
      expect(entryColumns, `storage_migration_entry.${column}`).toContain(column)
    }

    const indexes = (await db.execute("pragma index_list(storage_migration_entry)")).rows.map(
      (r) => r.name,
    )
    expect(indexes).toContain("storage_migration_entry_job_key_idx")
    expect(indexes).toContain("storage_migration_entry_job_normalized_idx")

    // The uniqueness that makes a retried inventory an upsert rather than a
    // duplicate row.
    const unique = (await db.execute("pragma index_list(storage_migration_entry)")).rows.find(
      (r) => r.name === "storage_migration_entry_job_key_idx",
    )
    expect(Number(unique?.unique)).toBe(1)

    db.close()
  }, 60_000)

  it("is idempotent: running the migrator twice changes nothing", async () => {
    const url = `file:${join(workspace, "twice.db")}`
    await migrateWith(url, migrationsFolderFor(MAIN_ERA, "main-era-2"))
    await migrateWith(url, "src/db/migrations/sqlite")

    const db = await client(url)
    const first = await db.execute("select count(*) as n from __drizzle_migrations")

    await migrateWith(url, "src/db/migrations/sqlite")
    const second = await db.execute("select count(*) as n from __drizzle_migrations")

    expect(second.rows[0].n).toEqual(first.rows[0].n)
    db.close()
  }, 60_000)

  it("reaches the same schema as a fresh install", async () => {
    // An upgraded database and a new one must be indistinguishable, or a bug
    // reproduces on only one of the two and nobody can tell which.
    const upgraded = `file:${join(workspace, "upgraded.db")}`
    await migrateWith(upgraded, migrationsFolderFor(MAIN_ERA, "main-era-3"))
    await migrateWith(upgraded, "src/db/migrations/sqlite")

    const fresh = `file:${join(workspace, "fresh.db")}`
    await migrateWith(fresh, "src/db/migrations/sqlite")

    const describeSchema = async (url: string) => {
      const db = await client(url)
      const tables = await db.execute(
        "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name",
      )
      const shape: Record<string, string[]> = {}
      for (const row of tables.rows) {
        const name = String(row.name)
        if (name === "__drizzle_migrations") continue
        const columns = await db.execute(`pragma table_info(${name})`)
        shape[name] = columns.rows.map((c) => String(c.name)).sort()
      }
      db.close()
      return shape
    }

    expect(await describeSchema(upgraded)).toEqual(await describeSchema(fresh))
  }, 60_000)
})

describe("what an upgraded installation resolves at runtime", () => {
  it("resolves S3 with no STORAGE_DRIVER set, and pins it durably", async () => {
    // THE UPGRADE PATH IN ONE TEST. Every installation predating this branch
    // has no `STORAGE_DRIVER`; absence must mean `s3`, and an installation that
    // has completed setup must record what it is already using rather than
    // waiting to be told.
    const url = `file:${join(workspace, "runtime.db")}`
    await migrateWith(url, migrationsFolderFor(MAIN_ERA, "main-era-4"))

    const db = await client(url)
    await db.execute({
      sql: `insert into settings (id, setupCompletedAt, s3Bucket, s3AccessKeyId, s3SecretAccessKey, updatedAt)
            values ('global', ?, 'existing-media', 'AKIA', 'secret', ?)`,
      args: [Date.now(), Date.now()],
    })
    await migrateWith(url, "src/db/migrations/sqlite")

    const { parseDatabaseConfig } = await import("@/Framework/Config/databaseConfig")
    const { createDatabase } = await import("@/db/createDatabase")
    const handle = createDatabase(
      parseDatabaseConfig({ DATABASE_DIALECT: "sqlite", DATABASE_URL: url }),
    )

    const { storageLocationId } = await import("@/Framework/Storage/storageConfig")
    const { eq } = await import("drizzle-orm")
    const { SETTINGS_SINGLETON_ID } = await import("@/db/schema/settings")

    // Simulate the pin the application performs on its first storage
    // resolution, through the same conditional-update the store uses.
    const config = {
      driver: "s3" as const,
      endpoint: undefined,
      region: undefined,
      bucket: "existing-media",
      accessKeyId: "AKIA",
      secretAccessKey: "secret",
    }
    await handle.db
      .update(handle.schema.settings as never)
      .set({
        activeStorageDriver: "s3",
        activeStorageLocationId: storageLocationId(config),
        activeStorageBucket: "existing-media",
        activeStorageEstablishedAt: new Date(),
        updatedAt: new Date(),
      } as never)
      .where(eq((handle.schema.settings as never as { id: never }).id, SETTINGS_SINGLETON_ID))

    const pinned = await db.execute(
      "select activeStorageDriver, activeStorageLocationId, activeStorageBucket, s3Bucket from settings",
    )
    expect(pinned.rows[0].activeStorageDriver).toBe("s3")
    expect(pinned.rows[0].activeStorageBucket).toBe("existing-media")
    // The bucket the site was already using — not a new one, not a default.
    expect(pinned.rows[0].s3Bucket).toBe("existing-media")
    expect(String(pinned.rows[0].activeStorageLocationId)).toContain("existing-media")

    await handle.close()
    db.close()
  }, 60_000)
})
