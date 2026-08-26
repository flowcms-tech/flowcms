import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { classifySetupState } from "@/Framework/Setup/setupState"

/**
 * THE SECURITY-CRITICAL UPGRADE CASE.
 *
 * A FlowCMS installation that has been running since Phase 6 has users, has
 * settings, and has never heard of `setupCompletedAt`. When its operator pulls
 * the Phase 7.1 image and the container migrates, the column appears — and if
 * it appears NULL, that live production site starts serving a public first-run
 * form offering ownership of itself to anyone holding the deployment token.
 *
 * So the backfill is not a convenience. It is the difference between an upgrade
 * and an incident, and it is proved here against a database genuinely built at
 * the older schema rather than one hand-edited to look like it.
 *
 * SQLite only, and deliberately: this asserts the BACKFILL SQL, and the
 * PostgreSQL and MySQL translations of it are proved by the four-engine matrix
 * running the same lifecycle against real engines.
 */

const PRE_7_1_TAGS = ["0000_baseline", "0001_active_theme", "0002_menus", "0003_theme_settings"]

/** A migrations folder containing only what existed before Phase 7.1. */
function pre71MigrationsFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), "flowcms-pre71-"))
  mkdirSync(join(dir, "meta"), { recursive: true })

  for (const tag of PRE_7_1_TAGS) {
    cpSync(`src/db/migrations/sqlite/${tag}.sql`, join(dir, `${tag}.sql`))
  }

  const journal = JSON.parse(readFileSync("src/db/migrations/sqlite/meta/_journal.json", "utf8"))
  journal.entries = journal.entries.filter((e: { tag: string }) => PRE_7_1_TAGS.includes(e.tag))
  expect(journal.entries).toHaveLength(PRE_7_1_TAGS.length)
  writeFileSync(join(dir, "meta", "_journal.json"), JSON.stringify(journal, null, 2))

  return dir
}

async function open(url: string) {
  const { createClient } = await import("@libsql/client")
  const client = createClient({ url })
  await client.execute("PRAGMA foreign_keys = ON")
  return client
}

async function migrateTo(url: string, folder: string) {
  const { drizzle } = await import("drizzle-orm/libsql")
  const { migrate } = await import("drizzle-orm/libsql/migrator")
  const client = await open(url)
  try {
    await migrate(drizzle(client), { migrationsFolder: folder })
  } finally {
    client.close()
  }
}

function freshUrl(): string {
  return `file:${join(mkdtempSync(join(tmpdir(), "flowcms-upgrade-")), "app.db")}`
}

/** The state a reader of the settings row would compute after the upgrade. */
async function setupStateOf(url: string) {
  const client = await open(url)
  try {
    const result = await client.execute("select setupCompletedAt from settings where id = 'global'")
    const row = result.rows[0]
    return classifySetupState(
      row ? { setupCompletedAt: row.setupCompletedAt as number | null } : null,
    )
  } finally {
    client.close()
  }
}

async function insertUser(url: string, email: string) {
  const client = await open(url)
  try {
    await client.execute({
      sql: `insert into user (id, name, email, passwordHash, isActive, role, createdAt, updatedAt)
            values (?, ?, ?, ?, 1, 'owner', ?, ?)`,
      args: [crypto.randomUUID(), "Existing Owner", email, "$2a$12$notarealhash", 1_700_000_000_000, 1_700_000_000_000],
    })
  } finally {
    client.close()
  }
}

describe("upgrading an installation that already has users", () => {
  it("closes setup, without touching the existing owner", async () => {
    const url = freshUrl()
    await migrateTo(url, pre71MigrationsFolder())

    // A Phase 6 installation: an owner, and a settings row with brand identity.
    await insertUser(url, "existing@example.com")
    const client = await open(url)
    try {
      await client.execute({
        sql: `insert into settings (id, siteName, tagline, activeTheme, updatedAt)
              values ('global', ?, ?, ?, ?)`,
        args: ["Established Site", "Running since Phase 6", "aurora", 1_700_000_000_000],
      })
      // Prove the column genuinely does not exist yet.
      const columns = await client.execute("pragma table_info(settings)")
      expect(columns.rows.map((r) => r.name)).not.toContain("setupCompletedAt")
    } finally {
      client.close()
    }

    // THE UPGRADE.
    await migrateTo(url, "src/db/migrations/sqlite")

    expect((await setupStateOf(url)).state).toBe("complete")

    const after = await open(url)
    try {
      const users = await after.execute("select id, email, role from user")
      expect(users.rows).toHaveLength(1)
      expect(users.rows[0].email).toBe("existing@example.com")
      expect(users.rows[0].role).toBe("owner")

      const settings = await after.execute("select * from settings")
      expect(settings.rows).toHaveLength(1)
      // Nothing unrelated was mutated: brand identity and the active theme
      // survive the upgrade exactly as they were.
      expect(settings.rows[0].siteName).toBe("Established Site")
      expect(settings.rows[0].tagline).toBe("Running since Phase 6")
      expect(settings.rows[0].activeTheme).toBe("aurora")
      expect(settings.rows[0].setupCompletedAt).toBeTruthy()
    } finally {
      after.close()
    }
  }, 60_000)

  it("closes setup when there are users but NO settings row", async () => {
    // The case that makes the backfill two statements instead of one. An
    // installation bootstrapped from the CLI that never opened the settings
    // screen has users and no row, so a bare UPDATE would match nothing and
    // leave setup wide open on a live site.
    const url = freshUrl()
    await migrateTo(url, pre71MigrationsFolder())
    await insertUser(url, "cli-bootstrapped@example.com")

    const before = await open(url)
    try {
      const rows = await before.execute("select count(*) as n from settings")
      expect(Number(rows.rows[0].n)).toBe(0)
    } finally {
      before.close()
    }

    await migrateTo(url, "src/db/migrations/sqlite")

    expect((await setupStateOf(url)).state).toBe("complete")

    const after = await open(url)
    try {
      const rows = await after.execute("select id, siteName, setupCompletedAt from settings")
      expect(rows.rows).toHaveLength(1)
      expect(rows.rows[0].id).toBe("global")
      expect(rows.rows[0].setupCompletedAt).toBeTruthy()
      // The backfill writes the marker and NOTHING else. It must not invent a
      // site name for an installation that deliberately had none.
      expect(rows.rows[0].siteName).toBeNull()
    } finally {
      after.close()
    }
  }, 60_000)
})

describe("upgrading a genuinely fresh installation", () => {
  it("leaves setup OPEN when there are no users", async () => {
    const url = freshUrl()
    await migrateTo(url, pre71MigrationsFolder())
    await migrateTo(url, "src/db/migrations/sqlite")

    expect((await setupStateOf(url)).state).toBe("incomplete")

    const client = await open(url)
    try {
      // The backfill inserted nothing: there was nothing to preserve.
      const rows = await client.execute("select count(*) as n from settings")
      expect(Number(rows.rows[0].n)).toBe(0)
    } finally {
      client.close()
    }
  }, 60_000)

  it("leaves setup OPEN when a settings row exists but no user does", async () => {
    const url = freshUrl()
    await migrateTo(url, pre71MigrationsFolder())

    const client = await open(url)
    try {
      await client.execute({
        sql: "insert into settings (id, siteName, updatedAt) values ('global', ?, ?)",
        args: ["Configured But Unowned", 1_700_000_000_000],
      })
    } finally {
      client.close()
    }

    await migrateTo(url, "src/db/migrations/sqlite")

    expect((await setupStateOf(url)).state).toBe("incomplete")
  }, 60_000)
})

describe("applying migrations twice", () => {
  it("is idempotent and does not move the marker", async () => {
    // Container restarts re-run the entrypoint's migration step. A backfill
    // that re-stamped the marker on every boot would be harmless here and
    // wrong in the audit trail; one that failed would take the container down.
    const url = freshUrl()
    await migrateTo(url, pre71MigrationsFolder())
    await insertUser(url, "existing@example.com")
    await migrateTo(url, "src/db/migrations/sqlite")

    const client = await open(url)
    let first: unknown
    try {
      const rows = await client.execute("select setupCompletedAt from settings where id='global'")
      first = rows.rows[0].setupCompletedAt
    } finally {
      client.close()
    }

    await migrateTo(url, "src/db/migrations/sqlite")

    const again = await open(url)
    try {
      const rows = await again.execute("select setupCompletedAt from settings where id='global'")
      expect(rows.rows[0].setupCompletedAt).toBe(first)
    } finally {
      again.close()
    }
  }, 60_000)
})
