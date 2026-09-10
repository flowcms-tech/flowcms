import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

/**
 * THE NON-DOCKER HALF OF `docker/entrypoint.sh`.
 *
 * The image migrates before it serves. `npm start` did not — it was bare
 * `next start` — so a buildpack deployment reported `migrations_pending`
 * forever against a database nobody had created. And `npm run db:migrate`, the
 * manual step create-flowcms prints for a local deployment, could not see the
 * `.env` it had just written: npm loads no `.env` for a script.
 *
 * Each test runs the real scripts in an empty temporary directory, so no
 * developer's .env.local can decide the outcome.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const MIGRATE = join(ROOT, "scripts", "migrate.mjs")
const START = join(ROOT, "scripts", "start.mjs")

/** The environment as a platform with no database configured presents it. */
function bareEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // Widened past NodeJS.ProcessEnv, and cast back on return: Next's own
  // next/types/global.d.ts augments NODE_ENV as a required, readonly property,
  // which blocks both `delete env.NODE_ENV` and returning an object that omits
  // it. The cast is safe — spawnSync's `env` is a plain string map at runtime,
  // and a bare platform genuinely has no NODE_ENV set.
  const env: Record<string, string | undefined> = { ...process.env }
  delete env.DATABASE_URL
  delete env.DATABASE_DIALECT
  delete env.NODE_ENV
  return { ...env, ...extra } as NodeJS.ProcessEnv
}

const created: string[] = []
function project(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "flowcms-start-"))
  created.push(dir)
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents)
  return dir
}
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const run = (script: string, cwd: string, env: NodeJS.ProcessEnv, args: string[] = []) =>
  spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: "utf8", timeout: 60_000 })

/**
 * A free port, picked by asking the OS for one and closing it again — never
 * 3000. `next start` binds its port "as fast as possible", before it checks
 * whether a build even exists, so a production-mode test that omits `-p` binds
 * 3000 regardless of whether the temp project it runs in has anything built.
 * `start.mjs` forwards its argv to `next start` unchanged, so `-p <port>` here
 * reaches it the same way `npm start -- -p 4000` would.
 */
function ephemeralPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = address && typeof address === "object" ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

describe("db:migrate reads the project's .env the way Next does", () => {
  it("finds DATABASE_URL in .env", () => {
    const dir = project({ ".env": "DATABASE_DIALECT=sqlite\nDATABASE_URL=file:./from-dotenv.db\n" })
    const result = run(MIGRATE, dir, bareEnv())
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(dir, "from-dotenv.db"))).toBe(true)
  })

  it("lets the real environment win over the file", () => {
    const dir = project({ ".env": "DATABASE_URL=file:./from-dotenv.db\n" })
    const result = run(MIGRATE, dir, bareEnv({ DATABASE_URL: "file:./from-env.db" }))
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(dir, "from-env.db"))).toBe(true)
    expect(existsSync(join(dir, "from-dotenv.db"))).toBe(false)
  })

  it("still refuses when nothing configures a database", () => {
    const result = run(MIGRATE, project(), bareEnv())
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("DATABASE_URL is required")
  })

  it("importing the migrator loads nothing (bootstrap-owner imports it)", () => {
    const dir = project({ ".env": "DATABASE_URL=file:./x.db\n" })
    const probe = `import(${JSON.stringify(pathToFileURL(MIGRATE).href)}).then(() => console.log(process.env.DATABASE_URL ?? "unset"))`
    const result = spawnSync(process.execPath, ["-e", probe], { cwd: dir, env: bareEnv(), encoding: "utf8" })
    expect(result.stdout.trim()).toBe("unset")
  })
})

describe("start migrates before it serves", () => {
  it("is the start script", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
    expect(manifest.scripts.start).toBe("node scripts/start.mjs")
  })

  it("a failed migration exits non-zero and never starts Next", () => {
    const result = run(START, project(), bareEnv())
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("DATABASE_URL is required")
    // O1: regression test — proves the production guard is called, not just resolveConfig
    expect(result.stderr).toContain("DATABASE_URL=file:data/app.db")
    expect(result.stdout).not.toContain("FlowCMS: starting server")
  })

  it("production migration fails with the upgrade hint when DATABASE_URL is missing", () => {
    const result = run(MIGRATE, project(), bareEnv({ NODE_ENV: "production" }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("DATABASE_URL=file:data/app.db")
  })

  it("migrates in production mode, reading the files next start will read, then starts Next", async () => {
    const dir = project({
      ".env.production": "DATABASE_URL=file:./production.db\n",
      ".env.development": "DATABASE_URL=file:./development.db\n",
    })
    const port = await ephemeralPort()
    const result = run(START, dir, bareEnv(), ["-p", String(port)])
    expect(existsSync(join(dir, "production.db")), result.stderr).toBe(true)
    expect(existsSync(join(dir, "development.db"))).toBe(false)
    // The temporary directory has no build, so Next itself exits non-zero —
    // what matters is that it was reached, after the migration.
    expect(result.stdout).toContain("FlowCMS: starting server")
    expect(result.status).not.toBe(0)
  })

  /**
   * I2: the migrator and `next start` must agree on which `.env*` files are
   * "production". `next start` always loads the production files — or the
   * test files when NODE_ENV=test — no matter what else NODE_ENV says. Before
   * this fix, `loadProjectEnv`'s `dev = process.env.NODE_ENV !== "production"`
   * meant a shell that merely EXPORTED NODE_ENV=development (a common habit,
   * not a request for the dev server) made the migrator read
   * `.env.development` and migrate that database, while `next start` went on
   * to serve the production one — unmigrated.
   */
  it("migrates the production database even when the shell already set NODE_ENV=development", async () => {
    const dir = project({
      ".env.production": "DATABASE_URL=file:./production.db\n",
      ".env.development": "DATABASE_URL=file:./development.db\n",
    })
    const port = await ephemeralPort()
    const result = run(START, dir, bareEnv({ NODE_ENV: "development" }), ["-p", String(port)])
    expect(existsSync(join(dir, "production.db")), result.stderr).toBe(true)
    expect(existsSync(join(dir, "development.db"))).toBe(false)
    expect(result.stdout).toContain("FlowCMS: starting server")
  })
})
