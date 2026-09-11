import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * ONE DATABASE HANDLE PER PROCESS, NOT ONE PER EVALUATION OF `@/db/client`.
 *
 * `next dev` re-evaluates server modules after a save without restarting Node.
 * While the handle was a plain module-scope constant, every re-evaluation called
 * `createDatabase()` again and orphaned the previous pool — up to
 * DATABASE_POOL_MAX connections each, with nothing left holding a reference that
 * could close them. A long editing session against MySQL ended in
 * `ER_CON_COUNT_ERROR: Too many connections` (issue #18).
 *
 * `vi.resetModules()` followed by a fresh import is the same event: the module
 * registry is thrown away, the process and its `globalThis` are not.
 *
 * SQLite in temp files, so no server is needed. The handle-reuse logic sits
 * above the driver switch, so what holds here holds for every driver.
 */

// Identity is asserted as a boolean on purpose: a failing `toBe` between two
// handles makes vitest diff the whole Drizzle object graph, which exhausts the
// heap instead of reporting the failure.
function sqliteUrl(): string {
  return `file:${join(mkdtempSync(join(tmpdir(), "flowcms-client-")), "app.db")}`
}

async function evaluateClient(url: string, dialect = "sqlite") {
  vi.stubEnv("DATABASE_DIALECT", dialect)
  vi.stubEnv("DATABASE_URL", url)
  vi.resetModules()
  return import("@/db/client")
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("the database handle across module re-evaluation", () => {
  it("reuses the handle instead of opening a second pool", async () => {
    const url = sqliteUrl()
    const first = await evaluateClient(url)
    const second = await evaluateClient(url)

    expect(second.handle === first.handle, "a second handle was created").toBe(true)
    expect(second.db === first.db, "a second Drizzle instance was created").toBe(true)
  })

  it("leaves the reused handle open and usable", async () => {
    const url = sqliteUrl()
    await evaluateClient(url)
    const second = await evaluateClient(url)

    await expect(second.handle.ping()).resolves.toBeUndefined()
  })

  it("follows a changed DATABASE_URL, and closes the handle it replaces", async () => {
    // Next reloads .env in place. Reusing the old handle would silently keep
    // talking to the previous database; leaving it open would be the leak again.
    const first = await evaluateClient(sqliteUrl())
    const second = await evaluateClient(sqliteUrl())

    expect(second.handle === first.handle, "the old handle was reused").toBe(false)
    await expect(second.handle.ping()).resolves.toBeUndefined()
    await expect(first.handle.ping()).rejects.toThrow()
  })

  it("follows a changed DATABASE_DIALECT even when the URL is the same", async () => {
    // MySQL and MariaDB share the mysql:// scheme, so the URL alone cannot say
    // which dialect a handle was built for. mysql2 connects lazily: no server
    // is contacted here.
    const url = "mysql://flowcms:secret@127.0.0.1:1/flowcms"
    await evaluateClient(url, "mysql")
    const second = await evaluateClient(url, "mariadb")

    expect(second.databaseDialect).toBe("mariadb")
  })
})
