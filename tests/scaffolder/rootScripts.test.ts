import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DROPPED_DEV_DEPENDENCIES,
  DROPPED_SCRIPTS,
  EXCLUDE,
  REWRITTEN_SCRIPTS,
} from "../../scripts/lib/templateManifest.mjs"

/**
 * THE ROOT MANIFEST IS ALSO THE TEMPLATE'S SOURCE.
 *
 * `package.json` is not only how this repository is built — `scripts/` is a
 * `DIRECTORIES` entry copied whole, and the generated project's manifest is
 * this one minus `DROPPED_SCRIPTS` and plus `REWRITTEN_SCRIPTS`. So every
 * script added here ships to every generated site by default, and a script that
 * names a file the manifest EXCLUDEs ships a command pointing at nothing.
 *
 * `tests/scaffolder/template.test.ts` catches that in the *result*, but only
 * after `build:template` has run. These assertions read the two manifests
 * directly, so the failure arrives without a build and names the pair that
 * disagreed.
 *
 * They also pin the three script defects the Phase 8 correction pass fixed:
 *
 *   `db:generate` / `db:studio`   ran `drizzle-kit` with no `--config` while
 *                                 only dialect-specific configs exist. Both
 *                                 were guaranteed to fail. Replaced by one
 *                                 command per dialect, each naming its config.
 *
 *   `test`                        chained `npm run …` from inside a script,
 *                                 which assumes the operator's manager is npm
 *                                 (or that npm is on PATH at all) in a project
 *                                 that supports four. Now direct `node` calls.
 *
 *   `jalaali-js`                  a previous-project dependency with no
 *                                 importer, shipped into every generated site.
 */

const ROOT = process.cwd()
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
const scripts: Record<string, string> = manifest.scripts

// The manifest is a plain `.mjs` data module with no declarations of its own,
// so its exports arrive with inferred literal shapes. Widening them here keeps
// the lookups below from being an index into a type with no index signature.
const dropped = DROPPED_SCRIPTS as Record<string, string>
const rewritten = REWRITTEN_SCRIPTS as Record<string, string>
const droppedDevDependencies = DROPPED_DEV_DEPENDENCIES as Record<string, string>
const exclude = EXCLUDE as string[]

/** Every `scripts/…` or `src/…` path a command names. */
function referencedPaths(command: string): string[] {
  return [...String(command).matchAll(/(?:^|\s)((?:scripts|src)\/[\w./-]+)/g)].map((m) => m[1])
}

const excluded = (path: string) =>
  exclude.some((entry) => path === entry || path.startsWith(`${entry}/`))

describe("the root scripts and the template manifest agree", () => {
  it("found scripts to check", () => {
    expect(Object.keys(scripts).length).toBeGreaterThan(10)
  })

  it("every script naming an excluded file is dropped or rewritten", () => {
    // THE PAIRING RULE. A script that names something `EXCLUDE` withholds is
    // fine here and broken there, so it must not survive into the generated
    // manifest — either dropped outright, or rewritten to a command that names
    // only what the template ships.
    const offenders = Object.entries(scripts)
      .filter(([name, command]) => {
        if (name in dropped) return false
        const effective = name in rewritten ? rewritten[name] : command
        return referencedPaths(effective).some(excluded)
      })
      .map(([name, command]) => `${name} → ${command}`)

    expect(
      offenders,
      "These root scripts name a path scripts/lib/templateManifest.mjs excludes. " +
        "Add each to DROPPED_SCRIPTS (or REWRITTEN_SCRIPTS with a command that " +
        "names only shipped files), or stop excluding what they need.",
    ).toEqual([])
  })

  it("every script this repository keeps names a file that exists", () => {
    const missing: string[] = []
    for (const [name, command] of Object.entries(scripts)) {
      for (const path of referencedPaths(command)) {
        if (!existsSync(join(ROOT, path))) missing.push(`${name} → ${path}`)
      }
    }
    expect(missing).toEqual([])
  })

  it("drops, rewrites and dependency drops all name something that is here", () => {
    // The builder makes the same checks and fails the build; this makes them
    // without one, so a rename shows up as a named test rather than as a
    // template build somebody runs later.
    for (const name of Object.keys(dropped)) {
      expect(scripts, `DROPPED_SCRIPTS names ${name}`).toHaveProperty(name)
    }
    for (const name of Object.keys(rewritten)) {
      expect(scripts, `REWRITTEN_SCRIPTS names ${name}`).toHaveProperty(name)
    }
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
    for (const name of Object.keys(droppedDevDependencies)) {
      expect(dependencies, `DROPPED_DEV_DEPENDENCIES names ${name}`).toHaveProperty(name)
    }
  })
})

describe("the database scripts are runnable", () => {
  const dialects = ["sqlite", "postgresql", "mysql"]

  it("has no plain drizzle.config.ts, which is why a bare command cannot work", () => {
    expect(existsSync(join(ROOT, "drizzle.config.ts"))).toBe(false)
  })

  it.each(dialects)("db:generate:%s names a config that exists", (dialect) => {
    const command = scripts[`db:generate:${dialect}`]
    expect(command, `db:generate:${dialect}`).toBeDefined()
    expect(command).toContain(`--config drizzle.config.${dialect}.ts`)
    expect(existsSync(join(ROOT, `drizzle.config.${dialect}.ts`))).toBe(true)
  })

  it.each(dialects)("db:studio:%s names a config that exists", (dialect) => {
    const command = scripts[`db:studio:${dialect}`]
    expect(command, `db:studio:${dialect}`).toBeDefined()
    expect(command).toContain(`--config drizzle.config.${dialect}.ts`)
    expect(existsSync(join(ROOT, `drizzle.config.${dialect}.ts`))).toBe(true)
  })

  it("has no MariaDB config, because MariaDB shares the MySQL track", () => {
    // Deliberate, and documented in drizzle.config.mysql.ts. MariaDB is
    // verified against a real MariaDB server rather than assumed compatible;
    // the moment it needs different SQL it gets its own config AND its own
    // scripts, and this assertion is what has to be changed to allow that.
    expect(existsSync(join(ROOT, "drizzle.config.mariadb.ts"))).toBe(false)
    expect(scripts["db:generate:mariadb"]).toBeUndefined()
  })

  it("keeps no generic db:generate or db:studio", () => {
    // They ran `drizzle-kit` with no `--config`. Drizzle then looks for
    // `drizzle.config.ts`, which this repository does not have, so both failed
    // every time they were run — while being the commands the documentation
    // told a new contributor to use.
    expect(scripts["db:generate"]).toBeUndefined()
    expect(scripts["db:studio"]).toBeUndefined()
  })

  it("every script naming a drizzle config is dropped from a generated project", () => {
    // The template FORBIDS `drizzle.config.*` outright — authoring migrations
    // is FlowCMS development, not site operation. A script naming one is
    // therefore a command a generated project could never run, and the
    // manifest half of the pair has to land with the package.json half.
    const offenders = Object.entries(scripts)
      .filter(([name, command]) => command.includes("drizzle.config") && !(name in dropped))
      .map(([name]) => name)
    expect(offenders).toEqual([])
  })

  it("never invokes drizzle-kit without saying which dialect", () => {
    const offenders = Object.entries(scripts)
      .filter(([, command]) => command.includes("drizzle-kit") && !command.includes("--config"))
      .map(([name]) => name)
    expect(offenders).toEqual([])
  })
})

describe("the scripts do not assume a package manager", () => {
  it("no script delegates to another script through a manager", () => {
    // `npm run build:packages` inside a script means `bun run test` needs npm
    // installed, and `pnpm test` runs half the chain under a different manager.
    // Calling `node` directly is the same work with no such assumption.
    //
    // `db:seed` is `bun run src/db/seed.ts` and is deliberately exempt: it
    // executes a FILE with Bun, which is a documented Bun-only development
    // path, rather than delegating to another entry in this table.
    const names = new Set(Object.keys(scripts))
    const offenders = Object.entries(scripts).filter(([, command]) =>
      [...command.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+run\s+([\w:-]+)/g)].some((m) =>
        names.has(m[1]),
      ),
    )
    expect(offenders.map(([name, command]) => `${name} → ${command}`)).toEqual([])
  })

  it("test builds the packages and the template before running the suite", () => {
    // THE ORDER IS LOAD-BEARING, not a convenience. tests/packaging reads
    // packages/flowcms/dist and tests/scaffolder reads the generated template,
    // and both refuse to skip when the artifact is missing — a suite that
    // quietly skipped its only packaging check would report green on a package
    // that was never built.
    const chain = referencedPaths(scripts.test)
    expect(chain).toEqual([
      ...referencedPaths(scripts["build:packages"]),
      ...referencedPaths(scripts["build:template"]),
    ])
    expect(scripts.test.endsWith("vitest run")).toBe(true)
  })
})

describe("the previous project's calendar dependency is gone from every manifest", () => {
  // package.json and the two lockfiles have to agree: `npm ci` refuses to
  // install when they do not, so a half-applied removal is a broken checkout
  // rather than a stale line.
  it.each(["package.json", "package-lock.json", "bun.lock"])("%s names no jalaali package", (file) => {
    expect(readFileSync(join(ROOT, file), "utf8")).not.toContain("jalaali")
  })
})
