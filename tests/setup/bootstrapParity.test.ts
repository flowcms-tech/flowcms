import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { BCRYPT_COST } from "@/Framework/Auth/password"
import { normalizeEmail } from "@/Framework/Auth/identity"
import {
  MAX_OWNER_EMAIL_LENGTH,
  MIN_OWNER_PASSWORD_LENGTH,
} from "@/Framework/Setup/completeSetup"

/**
 * There are two ways to create the first owner of a FlowCMS installation, and
 * there must not be two definitions of what that means.
 *
 *   web    POST /api/setup  ->  Framework/Setup/completeSetup.ts
 *   CLI    node scripts/bootstrap-owner.mjs
 *
 * The script cannot import the domain. It is plain ESM that runs under `node`
 * in the production image with no TypeScript loader — the same constraint
 * `migrate.mjs` lives under, and the reason both exist as `.mjs` at all. So the
 * rules are stated twice, and this test is what stops them drifting.
 *
 * It reads the script's SOURCE rather than importing it, because importing it
 * runs it.
 */

const SCRIPT = readFileSync("scripts/bootstrap-owner.mjs", "utf8")

/** Source with comments stripped, so a guard cannot be tripped or satisfied by prose. */
function code(source: string): string {
  const BLOCK = new RegExp("/\\*[\\s\\S]*?\\*/", "g")
  const LINE = new RegExp("(^|[^:])//.*$", "gm")
  return source.replace(BLOCK, "").replace(LINE, "$1")
}

const SCRIPT_CODE = code(SCRIPT)

function constantIn(source: string, name: string): number {
  const match = source.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)`))
  expect(match, `${name} not found in scripts/bootstrap-owner.mjs`).toBeTruthy()
  return Number(match![1])
}

describe("the two first-owner paths agree on the rules", () => {
  it("uses the same bcrypt cost", () => {
    // A weaker factor on one path would be invisible: both produce a valid
    // hash, both log in, and only the stored cost differs.
    expect(constantIn(SCRIPT_CODE, "BCRYPT_COST")).toBe(BCRYPT_COST)
  })

  it("uses the same minimum password length", () => {
    expect(constantIn(SCRIPT_CODE, "MIN_PASSWORD_LENGTH")).toBe(MIN_OWNER_PASSWORD_LENGTH)
  })

  it("uses the same maximum email length", () => {
    expect(SCRIPT_CODE).toContain(`email.length > ${MAX_OWNER_EMAIL_LENGTH}`)
  })

  it("normalizes email the same way", () => {
    // The product decides email identity, not the database collation — MySQL
    // and MariaDB compare case-insensitively while PostgreSQL and SQLite do
    // not. Two creation paths disagreeing here means one install treats
    // `User@…` and `user@…` as two accounts and another as one.
    expect(SCRIPT_CODE).toMatch(/String\(value\)\.trim\(\)\.toLowerCase\(\)/)
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com")
  })

  it("creates the account with role owner and active", () => {
    expect(SCRIPT_CODE).toMatch(/'owner'/)
  })

  it("refuses when any user already exists", () => {
    expect(SCRIPT_CODE).toMatch(/anyUserExists\(\)/)
  })

  it("refuses when the installation is already initialized", () => {
    // §44: web setup completes -> bootstrap must refuse. The marker is what
    // makes that true even after every user has been deleted.
    expect(SCRIPT_CODE).toMatch(/setupCompleted\(\)/)
  })

  it("closes first-run setup on success", () => {
    // §12: bootstrap owner -> /setup still open would be a security defect.
    expect(SCRIPT_CODE).toMatch(/setupCompletedAt/)
  })

  it("writes the owner and the marker in one transaction on every engine", () => {
    // Half-applied initialization is unrecoverable in either direction.
    expect(SCRIPT_CODE).toMatch(/batch\(/) // libsql
    expect(SCRIPT_CODE).toMatch(/sql\.begin\(/) // postgres.js
    expect(SCRIPT_CODE).toMatch(/beginTransaction\(\)/) // mysql2
    expect(SCRIPT_CODE).toMatch(/rollback\(\)/)
  })

  it("never logs the password", () => {
    // Every console call in the script, checked for the variable that holds it.
    const logs = SCRIPT_CODE.match(/console\.(log|error|warn)\([^\n]*/g) ?? []
    expect(logs.length).toBeGreaterThan(0)
    for (const line of logs) {
      expect(line, line).not.toMatch(/\bpassword\b(?!\s*(?:manager|policy))/)
    }
    expect(SCRIPT_CODE).toMatch(/split\(password\)\.join\("\*\*\*"\)/)
  })

  it("takes no site-identity input, and says so", () => {
    // Documented decision (§45): bootstrap is an owner primitive. Site identity
    // stays at its defaults until edited in Admin.
    expect(SCRIPT_CODE).not.toMatch(/FLOWCMS_SITE_NAME|FLOWCMS_TAGLINE/)
    expect(SCRIPT).toMatch(/Site identity is deliberately left at its defaults/)
  })
})

/**
 * The script, actually run, against a real SQLite database.
 *
 * Reading the source proves the rules are stated; running it proves they are
 * enforced. Migrations are applied first, exactly as `docker/entrypoint.sh`
 * does — importing `migrate.mjs` no longer starts a migration as a side effect,
 * which is a defect Phase 7.1 found and fixed (see the guard at the bottom of
 * that file).
 */
describe("the script, run for real", () => {
  function freshDatabase(): string {
    const url = `file:${join(mkdtempSync(join(tmpdir(), "flowcms-bootstrap-")), "app.db")}`
    execFileSync(process.execPath, ["scripts/migrate.mjs"], {
      env: { ...process.env, DATABASE_DIALECT: "sqlite", DATABASE_URL: url },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    return url
  }

  function run(url: string, env: Record<string, string> = {}) {
    return execFileSync(process.execPath, ["scripts/bootstrap-owner.mjs"], {
      env: {
        ...process.env,
        DATABASE_DIALECT: "sqlite",
        DATABASE_URL: url,
        FLOWCMS_OWNER_EMAIL: "Owner@Example.COM",
        FLOWCMS_OWNER_PASSWORD: "correct-horse-battery-staple",
        FLOWCMS_OWNER_NAME: "Ada Lovelace",
        ...env,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  }

  async function readBack(url: string) {
    const { createClient } = await import("@libsql/client")
    const client = createClient({ url })
    try {
      const owners = await client.execute("select id, email, role, isActive from user")
      const marker = await client.execute(
        "select setupCompletedAt, siteName, tagline from settings where id = 'global'",
      )
      return { owners: owners.rows, marker: marker.rows[0] }
    } finally {
      client.close()
    }
  }

  it("creates the owner AND closes setup, in one run", async () => {
    const url = freshDatabase()
    const output = run(url)

    expect(output).toContain("Owner created: owner@example.com")
    expect(output).toContain("First-run setup is now closed")

    const { owners, marker } = await readBack(url)
    expect(owners).toHaveLength(1)
    expect(owners[0].email).toBe("owner@example.com")
    expect(owners[0].role).toBe("owner")
    expect(marker?.setupCompletedAt).toBeTruthy()

    // Site identity untouched — the owner sets it in Admin.
    expect(marker?.siteName ?? null).toBeNull()
    expect(marker?.tagline ?? null).toBeNull()
  }, 60_000)

  it("refuses a second run on the same installation", async () => {
    const url = freshDatabase()
    run(url)

    let failed = false
    let stderr = ""
    try {
      run(url, { FLOWCMS_OWNER_EMAIL: "second@example.com" })
    } catch (error) {
      failed = true
      stderr = String((error as { stderr?: string }).stderr ?? "")
    }

    expect(failed).toBe(true)
    expect(stderr).toMatch(/already/i)

    const { owners } = await readBack(url)
    expect(owners).toHaveLength(1)
  }, 60_000)

  it("still refuses after every user has been deleted", async () => {
    // §44 in its sharpest form. The user-count check cannot catch this; only
    // the durable marker can.
    const url = freshDatabase()
    run(url)

    const { createClient } = await import("@libsql/client")
    const client = createClient({ url })
    try {
      await client.execute("delete from user")
    } finally {
      client.close()
    }

    let stderr = ""
    let failed = false
    try {
      run(url, { FLOWCMS_OWNER_EMAIL: "attacker@example.com" })
    } catch (error) {
      failed = true
      stderr = String((error as { stderr?: string }).stderr ?? "")
    }

    expect(failed).toBe(true)
    expect(stderr).toMatch(/already been initialized/i)

    const { owners } = await readBack(url)
    expect(owners).toHaveLength(0)
  }, 60_000)

  it("never prints the password, even when it fails", async () => {
    const url = freshDatabase()
    const secret = "correct-horse-battery-staple"

    const first = run(url)
    expect(first).not.toContain(secret)

    let combined = ""
    try {
      run(url, { FLOWCMS_OWNER_EMAIL: "second@example.com" })
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string }
      combined = `${e.stdout ?? ""}${e.stderr ?? ""}`
    }
    expect(combined).not.toContain(secret)
  }, 60_000)

  it("refuses a password shorter than the shared minimum, reporting the length only", () => {
    const url = freshDatabase()
    let stderr = ""
    try {
      run(url, { FLOWCMS_OWNER_PASSWORD: "short" })
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr ?? "")
    }
    expect(stderr).toContain(String(MIN_OWNER_PASSWORD_LENGTH))
    expect(stderr).not.toContain("short")
  }, 60_000)
})
