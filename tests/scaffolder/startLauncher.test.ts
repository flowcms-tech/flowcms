import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

const run = (script: string, cwd: string, env: NodeJS.ProcessEnv) =>
  spawnSync(process.execPath, [script], { cwd, env, encoding: "utf8", timeout: 60_000 })

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
    expect(result.stdout).not.toContain("FlowCMS: starting server")
  })

  it("migrates in production mode, reading the files next start will read, then starts Next", () => {
    const dir = project({
      ".env.production": "DATABASE_URL=file:./production.db\n",
      ".env.development": "DATABASE_URL=file:./development.db\n",
    })
    const result = run(START, dir, bareEnv())
    expect(existsSync(join(dir, "production.db")), result.stderr).toBe(true)
    expect(existsSync(join(dir, "development.db"))).toBe(false)
    // The temporary directory has no build, so Next itself exits non-zero —
    // what matters is that it was reached, after the migration.
    expect(result.stdout).toContain("FlowCMS: starting server")
    expect(result.status).not.toBe(0)
  })
})
