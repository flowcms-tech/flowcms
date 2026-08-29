import { describe, expect, it, vi } from "vitest"
import { existsSync, readFileSync, readdirSync, lstatSync } from "node:fs"
import { join, relative, sep } from "node:path"

/**
 * THE APPLICATION TEMPLATE that `create-flowcms` carries.
 *
 * It is built from this repository by `scripts/build-create-flowcms.mjs`, which
 * already refuses to emit a template with a missing path or an unmatched strip.
 * What this file adds is the checks that are about the RESULT rather than the
 * build: does the thing that came out contain an application, does it contain
 * anything it must not, and does every command in its `package.json` point at a
 * file that is actually there.
 *
 * That last one is the classic scaffolder defect. A generated project whose
 * `npm run db:migrate` names a script the template left behind works perfectly
 * for whoever built it and fails for everybody else, silently, until somebody
 * runs it.
 *
 * IT REQUIRES THE BUILD. `npm test` runs it first, and the guard below says so
 * rather than skipping — a suite that quietly skips its only template check
 * reports green on a scaffolder that ships nothing.
 */

// Several assertions read every text file in a 695-file template. That is
// slower than the suite's 20-second default when other files are running
// alongside it, and a guard that times out is a guard somebody deletes.
vi.setConfig({ testTimeout: 120_000 })

const ROOT = process.cwd()
const TEMPLATE = join(ROOT, "packages", "create-flowcms", "template")

function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return lstatSync(full).isDirectory()
      ? walk(full, base)
      : [relative(base, full).split(sep).join("/")]
  })
}

describe("the template exists", () => {
  it("has been built", () => {
    expect(
      existsSync(join(TEMPLATE, "package.json")),
      "packages/create-flowcms/template is missing — run `node scripts/build-create-flowcms.mjs` (npm test does this for you)",
    ).toBe(true)
  })
})

const FILES = walk(TEMPLATE)
const has = (path: string) => FILES.includes(path)
const read = (path: string) => readFileSync(join(TEMPLATE, path.split("/").join(sep)), "utf8")

describe("a generated project contains an application", () => {
  it.each([
    ["package.json", "the project manifest"],
    ["tsconfig.json", "TypeScript configuration"],
    ["tsconfig.package.json", "named by scripts/build-package.mjs"],
    ["next.config.ts", "the Next configuration"],
    ["src/next-globals.d.ts", "Next's ambient types, tracked because next-env.d.ts is not"],
    ["postcss.config.mjs", "how Tailwind is applied"],
    ["eslint.config.mjs", "named by the lint script"],
    [".env.example", "the authoritative configuration reference"],
    ["gitignore", "the ignore file, renamed to .gitignore on scaffold"],
    [".dockerignore", "the Docker build context filter"],
    ["Dockerfile", "the production image"],
    ["compose.yml", "the default local stack"],
    ["README.md", "what the operator reads first"],
    ["src/app/layout.tsx", "the root layout"],
    ["src/app/page.tsx", "the public home route"],
    ["src/proxy.ts", "the admin-path router"],
    ["src/instrumentation.ts", "startup configuration checks"],
    ["src/db/client.ts", "the database client"],
    ["src/Themes/registry.ts", "the theme registry"],
    ["src/Themes/packages.ts", "where an operator installs a theme"],
    ["src/Themes/contract/index.ts", "the public theme API's source"],
    ["packages/flowcms/package.json", "the local flowcms package"],
    ["scripts/migrate.mjs", "named by db:migrate"],
    ["scripts/bootstrap-owner.mjs", "named by db:bootstrap-owner"],
    ["scripts/copy-tinymce.mjs", "named by postinstall"],
    ["scripts/build-package.mjs", "named by build:packages"],
    ["scripts/lib/packageEmit.mjs", "imported by build-package.mjs"],
    ["scripts/collect-db-drivers.mjs", "run by the Dockerfile"],
    ["docker/entrypoint.sh", "copied by the Dockerfile"],
    ["docs/setup/first-run.md", "referenced by the generated README"],
  ])("ships %s (%s)", (path) => {
    expect(has(path)).toBe(true)
  })

  it("ships every database migration, for every dialect", () => {
    // The scaffolder chooses no database, so it may delete no dialect. Phase
    // 7.4 selects one; until then all four have to be there or the choice does
    // not exist.
    for (const dialect of ["sqlite", "postgresql", "mysql"]) {
      const migrations = FILES.filter((f) => f.startsWith(`src/db/migrations/${dialect}/`))
      expect(migrations.length, dialect).toBeGreaterThan(0)
    }
  })

  it("ships the whole application, not a sample of it", () => {
    // A blunt lower bound, and it is enough: the failure it catches is an
    // exclusion pattern that swallowed a directory, which shows up as hundreds
    // of files missing rather than one.
    expect(FILES.filter((f) => f.startsWith("src/")).length).toBeGreaterThan(400)
  })
})

describe("a generated project contains no repository leakage", () => {
  it.each([
    [/(^|\/)\.env$/, "a real environment file"],
    [/(^|\/)\.env\.(?!example)/, "a non-example environment file"],
    [/data-info/, "the local credentials scratch file"],
    [/\.db($|-)/, "a database"],
    [/\.sqlite/, "a database"],
    [/(^|\/)node_modules\//, "installed dependencies"],
    [/(^|\/)\.git\//, "repository history"],
    [/(^|\/)\.claude\//, "local agent tooling"],
    [/(^|\/)\.next\//, "build output"],
    [/(^|\/)tests?\//, "the repository test suite"],
    [/superpowers/, "internal planning documents"],
    [/\.tgz$/, "a package tarball"],
    [/\.pem$|\.key$/, "a private key"],
    [/vitest\.config/, "the test runner configuration"],
    [/flowcms-theme-aurora/, "the example theme fixture"],
    [/src\/Themes\/integration\//, "the integration theme fixture"],
    [/public\/assets\/tinymce\//, "9.8 MB of editor assets that postinstall regenerates"],
    [/src\/db\/seed\.ts/, "development sample data"],
    [/CLAUDE\.md|AGENTS\.md|CONTRIBUTING\.md|SECURITY\.md|CODE_OF_CONDUCT\.md/, "repository governance documents"],
    [/CHANGELOG\.md/, "this repository's release history, which is not the generated project's"],
    [/(^|\/)\.github\//, "FlowCMS's own issue templates, PR template and workflows"],
    [/implementation-reports/, "internal phase reports"],
    [/(^|\/)\.codex\/|(^|\/)\.cursor\/|(^|\/)\.impeccable\//, "local agent and design tooling"],
    [/PROJECT_DOCUMENTATION\.md/, "the FlowCMS project's own architecture document"],
    [/drizzle\.config/, "migration-authoring configuration"],
  ])("contains nothing matching %s (%s)", (pattern) => {
    expect(FILES.filter((f) => pattern.test(f))).toEqual([])
  })

  it("contains no symbolic link", () => {
    // A link is how a "standalone" project ends up reading the machine it was
    // generated on. The build refuses to create one; this checks the result.
    const links: string[] = []
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        const stats = lstatSync(full)
        if (stats.isSymbolicLink()) links.push(relative(TEMPLATE, full))
        else if (stats.isDirectory()) scan(full)
      }
    }
    if (existsSync(TEMPLATE)) scan(TEMPLATE)
    expect(links).toEqual([])
  })

  it("mentions no absolute path from the machine that built it", () => {
    // The one that would make a generated project work only here.
    const textual = FILES.filter((f) => /\.(json|ts|tsx|mjs|js|css|md|yml|yaml|sh)$/.test(f))
    const offenders = textual.filter((f) => {
      const source = read(f)
      return /[A-Za-z]:[\\/]Tenetup/.test(source) || source.includes("/flowcms-codes/")
    })
    expect(offenders).toEqual([])
  })
})

describe("the fixture strips actually removed the fixtures", () => {
  it("packages.ts registers no theme and imports none", () => {
    const source = read("src/Themes/packages.ts")
    expect(source).not.toContain("@example/")
    expect(source).not.toContain("aurora")
    // And still compiles to something meaningful: an empty registration.
    expect(source).toMatch(/export function packageThemes\(\): ThemeEntry\[\] \{[\s\S]*return \[\][\s\S]*\}/)
  })

  it("packages.ts still tells an operator how to install a theme", () => {
    // Stripping the fixture must not strip the instructions with it.
    const source = read("src/Themes/packages.ts")
    expect(source).toMatch(/manifest\.slug/)
    expect(source).toMatch(/@source/)
  })

  it("registry.ts no longer imports the integration theme", () => {
    const source = read("src/Themes/registry.ts")
    expect(source).not.toContain("./integration")
    expect(source).not.toContain("integrationThemes")
    // The default theme is still registered — a registry without it throws.
    expect(source).toContain('["default", defaultTheme]')
  })

  it("globals.css registers no fixture package with Tailwind", () => {
    const source = read("src/app/globals.css")
    expect(source).not.toContain("@example/")
    expect(source).toContain('@import "tailwindcss"')
  })

  it("the Dockerfile copies and builds only what the project has", () => {
    const source = read("Dockerfile")
    expect(source).not.toContain("flowcms-theme-aurora")
    expect(source).not.toContain("build-example-theme")
    expect(source).toContain("COPY packages/flowcms/package.json")
    expect(source).toContain("node scripts/build-package.mjs")
  })

  it("leaves no strip marker behind", () => {
    const offenders = FILES.filter(
      (f) => /\.(ts|tsx|mjs|css|json|md|yml)$/.test(f) || f === "Dockerfile",
    ).filter((f) => read(f).includes("flowcms:template-strip"))
    expect(offenders).toEqual([])
  })

  it("sets no integration env gate anywhere", () => {
    // An operator's Appearance screen must not contain a test theme, and the
    // surest way to ship one would be to also ship the variable that reveals it.
    const configs = FILES.filter((f) => /^(\.env\.example|compose.*\.yml|Dockerfile)$/.test(f))
    expect(configs.length).toBeGreaterThan(3)
    for (const file of configs) {
      expect(read(file), file).not.toMatch(/FLOWCMS_INTEGRATION_THEMES\s*[:=]\s*["']?1/)
    }
  })
})

describe("every generated script points at a file that exists", () => {
  const manifest = JSON.parse(read("package.json"))

  it("found scripts to check", () => {
    expect(Object.keys(manifest.scripts).length).toBeGreaterThan(5)
  })

  it.each(Object.entries(JSON.parse(readFileSync(join(TEMPLATE, "package.json"), "utf8")).scripts))(
    "%s → %s",
    (_name, command) => {
      // THE CLASSIC SCAFFOLDER DEFECT: a manifest full of commands naming files
      // the template left behind. Works for whoever built it; fails for
      // everyone else, quietly, until somebody runs it.
      for (const match of String(command).matchAll(/(?:^|\s)((?:scripts|src|docker)\/[\w./-]+)/g)) {
        expect(has(match[1]), `${command} names ${match[1]}`).toBe(true)
      }
    },
  )

  it("names no script that was dropped from the template", () => {
    for (const dropped of [
      "test",
      "test:watch",
      "db:seed",
      "build:example-theme",
      // One per dialect, because there is one Drizzle config per dialect and
      // the template ships none of them.
      "db:generate:sqlite",
      "db:generate:postgresql",
      "db:generate:mysql",
      "db:studio:sqlite",
      "db:studio:postgresql",
      "db:studio:mysql",
      // The names these replaced. A generated project must not carry them
      // under any spelling.
      "db:generate",
      "db:studio",
    ]) {
      expect(manifest.scripts, dropped).not.toHaveProperty(dropped)
    }
  })

  it("keeps the commands an operator actually needs", () => {
    for (const kept of ["dev", "build", "start", "lint", "typecheck", "db:migrate", "build:packages"]) {
      expect(manifest.scripts, kept).toHaveProperty(kept)
    }
  })

  it("builds the local package with a script the project has", () => {
    expect(manifest.scripts["build:packages"]).toBe("node scripts/build-package.mjs")
  })
})

/**
 * THE OTHER DIRECTION, and the one that had been missing.
 *
 * The block above asks "does every command name a file that exists". This asks
 * "does every file exist for a reason" — and it is the harder question, because
 * the failure it catches is silent. `scripts` is a `DIRECTORIES` entry in the
 * manifest, copied WHOLE minus an explicit `EXCLUDE` list, so a script added to
 * this repository ships to every generated site by default. Nobody notices: the
 * project still builds, still runs, and simply carries somebody else's release
 * tooling.
 *
 * Phase 8 added eight such files before anyone looked — a package-manager
 * matrix harness, four CI helpers, an artifact-hygiene checker and two release
 * scripts, every one about THIS repository. The leakage check further up could
 * not see any of them, because it is a list of patterns and a pattern list only
 * catches what somebody already thought of. This one needs nobody to think of
 * anything: it is default-deny, and a new script is an orphan until something a
 * generated project actually runs names it.
 *
 * REACHABILITY IS COMPUTED, NOT LISTED. An allowlist here would be a second
 * copy of the manifest, and two lists disagree. The roots are the three
 * surfaces a generated project executes — its `package.json` scripts, its
 * `Dockerfile` and its entrypoint — and imports are followed from there.
 *
 * A path named in a COMMENT on one of those three surfaces counts as reachable.
 * That is deliberate: those files are small, generated and reviewed, so naming
 * a script in one of them is somebody writing it down. It is exactly what keeps
 * `scripts/matrix-marker.mjs` legitimate — the runner stage copies it, with a
 * comment saying which tool uses it — while nothing names the release scripts.
 */
describe("the template ships no script nothing runs", () => {
  const SCRIPTS = FILES.filter((file) => file.startsWith("scripts/"))

  /** "scripts" + "./lib/x.mjs" → "scripts/lib/x.mjs", without node:path's separators. */
  function resolveFrom(dir: string, specifier: string): string {
    const parts = dir.split("/").filter(Boolean)
    for (const segment of specifier.split("/")) {
      if (segment === "" || segment === ".") continue
      if (segment === "..") parts.pop()
      else parts.push(segment)
    }
    return parts.join("/")
  }

  /**
   * The Compose files a generated project ships.
   *
   * A FOURTH EXECUTION SURFACE, added when `compose.dev.yml` grew a `command:`.
   * The development overlay builds the `builder` stage, which carries no
   * ENTRYPOINT — `Dockerfile` declares one only in `runner` — so the overlay
   * names `scripts/dev-container-start.mjs` directly to migrate before serving.
   * That script is genuinely reachable in a generated project, and a
   * reachability check that only knew about package.json, the Dockerfile and
   * the entrypoint would call it an orphan and demand it be excluded — which
   * would ship a `command:` pointing at a file that is not there.
   */
  const COMPOSE_FILES = [
    "compose.yml",
    "compose.dev.yml",
    "compose.external-s3.yml",
    "compose.postgres.yml",
    "compose.mysql.yml",
    "compose.mariadb.yml",
  ]

  function reachable(): Set<string> {
    // The surfaces a generated project executes. Anything absent from the
    // template contributes nothing, which is why each is guarded.
    const roots = [
      JSON.stringify(JSON.parse(read("package.json")).scripts ?? {}),
      has("Dockerfile") ? read("Dockerfile") : "",
      has("docker/entrypoint.sh") ? read("docker/entrypoint.sh") : "",
      ...COMPOSE_FILES.map((file) => (has(file) ? read(file) : "")),
    ].join("\n")

    // Unanchored on purpose: a Dockerfile writes `/app/scripts/migrate.mjs` and
    // `./scripts/migrate.mjs` in the same line, and neither is preceded by a
    // word boundary this could rely on.
    const queue = [...roots.matchAll(/scripts\/[\w./-]+/g)].map((match) => match[0])
    const seen = new Set<string>()

    while (queue.length > 0) {
      const current = queue.pop()!
      // A root may name something the template deliberately does not ship —
      // `scripts/db-matrix.sh` is named in a Dockerfile comment and excluded
      // from the template. Not shipped is not a problem; shipped and unnamed is.
      if (seen.has(current) || !has(current)) continue
      seen.add(current)
      if (!/\.(mjs|cjs|js)$/.test(current)) continue

      const dir = current.slice(0, current.lastIndexOf("/"))
      const source = read(current)
      for (const match of source.matchAll(
        /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g,
      )) {
        queue.push(resolveFrom(dir, match[1]))
      }
    }

    return seen
  }

  it("found scripts to check", () => {
    expect(SCRIPTS.length).toBeGreaterThan(0)
  })

  it("every script is reached from a command, the image build or another script", () => {
    const live = reachable()
    const orphans = SCRIPTS.filter((file) => !live.has(file))

    expect(
      orphans,
      "These shipped to a generated project and nothing there runs them. Either " +
        "the generated project genuinely needs them — in which case something it " +
        "executes should name them — or they belong in EXCLUDE in " +
        "scripts/lib/templateManifest.mjs.",
    ).toEqual([])
  })

  it("carries none of this repository's CI or release tooling", () => {
    // The specific instance of the rule above, named so a regression reads as
    // what it is rather than as a generic orphan.
    const offenders = SCRIPTS.filter((file) =>
      /^scripts\/ci\/|release-|verify-|db-matrix|build-create-flowcms|build-example-theme/.test(
        file,
      ),
    )
    expect(offenders).toEqual([])
  })
})

describe("the generated manifest is standalone", () => {
  const manifest = JSON.parse(read("package.json"))

  it("is private", () => {
    expect(manifest.private).toBe(true)
  })

  it("depends on the local flowcms package by relative path", () => {
    // `file:packages/flowcms`, which the template carries. Not a registry
    // version that does not exist yet, and not a path into this repository.
    expect(manifest.devDependencies.flowcms).toBe("file:packages/flowcms")
    expect(has("packages/flowcms/package.json")).toBe(true)
    expect(has("packages/flowcms/src")).toBe(false) // it builds from the app's own contract
  })

  it("declares no dependency the template cannot satisfy", () => {
    const all = { ...manifest.dependencies, ...manifest.devDependencies }
    for (const [name, range] of Object.entries(all) as [string, string][]) {
      if (!/^(file|link|workspace|portal):/.test(range)) continue
      expect(range.startsWith("file:"), `${name} uses ${range}`).toBe(true)
      const target = range.slice("file:".length)
      expect(has(`${target}/package.json`), `${name} → ${target}`).toBe(true)
    }
  })

  it("drops the fixture and the tools only this repository needs", () => {
    for (const dropped of ["@example/flowcms-theme-aurora", "vitest", "drizzle-kit"]) {
      expect(manifest.devDependencies, dropped).not.toHaveProperty(dropped)
    }
  })

  it("keeps every runtime dependency the application has", () => {
    // The scaffolder chooses nothing, so it removes nothing the app runs on —
    // all four database drivers included.
    for (const kept of ["next", "react", "drizzle-orm", "@libsql/client", "postgres", "mysql2", "@aws-sdk/client-s3"]) {
      expect(manifest.dependencies, kept).toHaveProperty(kept)
    }
  })

  it("ships no lockfile", () => {
    // This repository's lockfile names `flowcms-app` and the Aurora
    // devDependency; it is wrong for every generated project. The selected
    // package manager writes its own.
    expect(FILES.filter((f) => /package-lock\.json|pnpm-lock|yarn\.lock|bun\.lock/.test(f))).toEqual([])
  })

  it("declares no packageManager it cannot honour", () => {
    // The field would have to name whichever manager the operator chose, and
    // pinning a version we cannot detect reliably would simply be untrue.
    expect(manifest.packageManager).toBeUndefined()
  })
})

describe("the architecture the scaffolder must not touch", () => {
  it("keeps all four database dialects", () => {
    for (const file of ["src/db/createDatabase.ts", "src/db/tables.ts"]) {
      expect(has(file), file).toBe(true)
    }
    const drivers = read("package.json")
    for (const driver of ["@libsql/client", "postgres", "mysql2"]) {
      expect(drivers).toContain(driver)
    }
  })

  it("keeps S3 storage and the bundled Garage compose service", () => {
    expect(has("src/Framework/Storage/StorageService.ts")).toBe(true)
    expect(has("docker/garage.toml")).toBe(true)
    expect(read("compose.yml")).toContain("garage")
  })

  it("keeps the admin path runtime-configurable", () => {
    expect(has("src/Framework/Config/adminPath.ts")).toBe(true)
    expect(read(".env.example")).toContain("FLOWCMS_ADMIN_PATH")
    // Nothing may hardcode the public path in place of the variable.
    expect(read("src/proxy.ts")).toContain("FLOWCMS_ADMIN_PATH")
  })

  it("keeps first-run setup", () => {
    expect(has("src/app/setup/page.tsx")).toBe(true)
    expect(has("src/app/api/setup/route.ts")).toBe(true)
    expect(has("src/Framework/Setup/completeSetup.ts")).toBe(true)
  })

  it("keeps the AUTH_SECRET and CAPTCHA_SECRET safeguards", () => {
    expect(has("src/Framework/Auth/authSecretConfig.ts")).toBe(true)
    expect(has("src/Framework/Captcha/captchaConfig.ts")).toBe(true)
    expect(has("src/Framework/Config/deploymentSecret.ts")).toBe(true)
  })

  it("ships a .env.example whose secrets are refused placeholders", () => {
    const example = read(".env.example")
    for (const variable of ["AUTH_SECRET", "CAPTCHA_SECRET", "FLOWCMS_SETUP_TOKEN"]) {
      expect(example, variable).toContain(variable)
    }
    // The application refuses its own example values; that is the point of them.
    expect(example).toMatch(/replace-me|REPLACE|change/i)
  })

  it("carries no customer or demo residue", () => {
    const textual = FILES.filter((f) => /\.(ts|tsx|md|json|css|yml)$/.test(f))
    for (const file of textual) {
      expect(read(file).toLowerCase(), file).not.toContain("lockdoc")
    }
  })
})
