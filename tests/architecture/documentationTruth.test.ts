import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Documentation that contradicts the repository, caught without reading it.
 *
 * Every assertion here corresponds to a statement that WAS in these files and
 * WAS false — found during the Phase 8 correction pass, when three sub-agents
 * changed the scripts, the shared components and the release order underneath
 * a documentation set nobody re-read. The failure mode is specific and it is
 * not cosmetic: `CONTRIBUTING.md` is what a new contributor is told to read
 * BEFORE touching anything, so a stale sentence there is an instruction to
 * write the wrong code, and `docs/distribution/**`, `docs/setup/**` and
 * `docs/themes/**` ship to strangers.
 *
 * Scope is the PUBLIC documentation set. Phase 9.10E moved every internal
 * document into the gitignored `dev-docs/`, which this suite deliberately does
 * not police — private notes are allowed to go stale; published ones are not.
 *
 * The scope is deliberately narrow. This suite checks facts a regex can settle
 * — a command that exists, a file that exists, a name that was removed. It
 * cannot check whether prose is *right*, and pretending otherwise would make it
 * a suite people learn to work around rather than one they trust.
 */

const ROOT = process.cwd()

/** Documents this repository maintains. Not an exhaustive list of markdown. */
const DOCS = [
  "README.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "docs/ci.md",
  "docs/docker.md",
  "docs/setup/first-run.md",
  "docs/distribution/create-flowcms.md",
  "docs/distribution/packages.md",
  "docs/distribution/package-managers.md",
  "docs/themes/authoring.md",
]

function read(file: string): string {
  return readFileSync(join(ROOT, file), "utf8")
}

const manifest = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

describe("every maintained document exists", () => {
  it.each(DOCS)("%s", (file) => {
    expect(existsSync(join(ROOT, file)), `${file} is listed here but absent`).toBe(true)
  })
})

describe("no document names a script that was removed", () => {
  // `db:generate` and `db:studio` invoked drizzle-kit with no --config, and
  // there is no plain drizzle.config.ts for a config-less invocation to find,
  // so they failed every time anyone ran them — while being the commands
  // CLAUDE.md and PROJECT_DOCUMENTATION.md told a new contributor to use. They
  // were replaced by one command per dialect.
  //
  // The pattern requires the `run ` prefix and forbids a following colon, so
  // prose explaining that the bare names are GONE still passes. Documenting a
  // removal is the point; instructing someone to run it is the defect.
  const invocation = /\b(?:npm|pnpm|yarn|bun)\s+run\s+db:(?:generate|studio)(?![:\w])/

  it.each(DOCS)("%s does not tell anyone to run a bare db:generate/db:studio", (file) => {
    const match = read(file).match(invocation)
    expect(match?.[0], `${file}: ${match?.[0]} does not exist in package.json`).toBeUndefined()
  })
})

describe("every FlowCMS script a document names actually exists", () => {
  // Catches the general case the rule above is one instance of: a document
  // naming `npm run <something>` that package.json does not define. Limited to
  // this project's own script vocabulary, because a document may legitimately
  // quote a GENERATED project's scripts, and those live in a different manifest.
  const OURS = /\b(?:npm|pnpm|yarn|bun)\s+run\s+((?:db|build|test):[\w:-]+)/g

  it.each(DOCS)("%s", (file) => {
    const named = [...read(file).matchAll(OURS)]
      .map((m) => m[1])
      // `npm run db:generate:{sqlite,postgresql,mysql}` is brace expansion, not
      // a script name, and it captures as the truncated `db:generate:`. A name
      // ending in a colon is always that shape; the three real names it stands
      // for are checked by their own suite below.
      .filter((name) => !name.endsWith(":"))
    const missing = named.filter((name) => !(name in manifest.scripts))
    expect(missing, `${file} names scripts package.json does not define`).toEqual([])
  })
})

describe("the dialect-specific database scripts name configs that exist", () => {
  const dialects = ["sqlite", "postgresql", "mysql"]

  it.each(dialects)("db:generate:%s and db:studio:%s point at a real config", (dialect) => {
    for (const verb of ["generate", "studio"]) {
      const script = manifest.scripts[`db:${verb}:${dialect}`]
      expect(script, `db:${verb}:${dialect} is missing`).toBeTruthy()
      expect(script).toContain(`drizzle.config.${dialect}.ts`)
      expect(existsSync(join(ROOT, `drizzle.config.${dialect}.ts`))).toBe(true)
    }
  })

  it("has no plain drizzle.config.ts, which is why the bare commands cannot work", () => {
    expect(existsSync(join(ROOT, "drizzle.config.ts"))).toBe(false)
  })

  it("has no MariaDB config or script — it shares the MySQL track deliberately", () => {
    // Documented in CLAUDE.md, CONTRIBUTING.md, README.md and
    // drizzle.config.mysql.ts's own doc comment. Inventing a fourth config
    // means changing this assertion, which is where the reason is written down.
    expect(existsSync(join(ROOT, "drizzle.config.mariadb.ts"))).toBe(false)
    expect(Object.keys(manifest.scripts).filter((s) => s.includes("mariadb"))).toEqual([])
  })
})

describe("no document mandates a single package manager", () => {
  // The runtime is Node; the package manager is the operator's choice, at four
  // different levels of evidence. CLAUDE.md used to open its Commands section
  // by forbidding npm outright, which contradicted the Docker image, the
  // production build command and the manager-neutral test chain three sections
  // below it.
  const mandate = /always use \**(?:bun|npm|pnpm|yarn)\**,? +never/i

  it.each(DOCS)("%s", (file) => {
    expect(mandate.test(read(file)), `${file} forbids a supported package manager`).toBe(false)
  })
})

describe("no document says the removed variable is still read", () => {
  // DATABASE_PATH was removed in Phase 5 and replaced by DATABASE_DIALECT +
  // DATABASE_URL. Prose recording the removal is required, not forbidden — so
  // this checks only that no document presents it as something to SET.
  const assignment = /DATABASE_PATH\s*=/

  it.each(DOCS)("%s", (file) => {
    expect(assignment.test(read(file)), `${file} assigns DATABASE_PATH`).toBe(false)
  })

  it("the environment example does not offer it either", () => {
    const env = read(".env.example")
    expect(/^DATABASE_PATH\s*=/m.test(env)).toBe(false)
    expect(env).toContain("DATABASE_URL")
    expect(env).toContain("DATABASE_DIALECT")
  })
})

describe("no document describes create-flowcms as unbuilt", () => {
  // docs/setup/first-run.md said "that tool does not exist yet" for three
  // phases after it was written. It exists; it is UNPUBLISHED, which is a
  // different claim and the one the documents must make.
  const unbuilt = /(?:create-flowcms|that tool)[^.\n]{0,60}(?:does not exist yet|doesn't exist yet|is not built yet)/i

  it.each(DOCS)("%s", (file) => {
    expect(unbuilt.test(read(file)), `${file} says create-flowcms does not exist`).toBe(false)
  })

  it("the scaffolder is on disk", () => {
    expect(existsSync(join(ROOT, "packages/create-flowcms/package.json"))).toBe(true)
    expect(existsSync(join(ROOT, "packages/create-flowcms/src/secrets.mjs"))).toBe(true)
  })
})

describe("first-run setup documents the installer boundary", () => {
  const doc = read("docs/setup/first-run.md")

  it("names the scaffolder and what it writes", () => {
    // This asserted the document contained the words "not published", which was
    // true until 0.1.1 shipped and is now the opposite of true. The durable
    // requirement was never the publication status: it is that the document
    // says which tool writes the deployment configuration, so a reader knows
    // what produced the `.env` they are being asked about.
    expect(doc).toMatch(/create-flowcms/)
    expect(doc.replace(/\s+/g, " ")).toMatch(/deployment configuration/i)
  })

  it("keeps the line the feature does not cross: the scaffolder creates no owner", () => {
    // The whole point of the document. If the scaffolder ever appears to
    // initialize a CMS, first-run setup's fail-closed marker means the mistake
    // is permanent for that installation.
    expect(doc.replace(/\s+/g, " ")).toMatch(/no owner account/i)
  })
})

describe("the previous project is described as removed, not present", () => {
  // Sub-agent B deleted it; tests/architecture/productResidue.test.ts keeps it
  // deleted. This is the documentation half: CLAUDE.md described the Customers
  // module, the Iranian-banking helpers and a Jalali-only DateFunctions as
  // things a contributor would still encounter.
  const gone = [
    "src/Modules/Customers",
    "src/components/shared/ElementCardNumber",
    "src/components/shared/ElementAmount",
    "src/__mocks__",
  ]

  it.each(gone)("%s is absent from the tree", (path) => {
    expect(existsSync(join(ROOT, path))).toBe(false)
  })

  it.each(DOCS)("%s does not tell modules to pass locale=\"en\"", (file) => {
    // The prop does not exist any more, so following that instruction is a
    // type error rather than a no-op.
    expect(read(file)).not.toMatch(/pass\s+`?locale="en"`?\s+explicitly/)
  })

  it("no manifest still carries the calendar dependency", () => {
    const deps = { ...manifest.dependencies, ...manifest.devDependencies }
    expect(Object.keys(deps).filter((d) => d.includes("jalaali"))).toEqual([])
  })
})

describe("no document presents an uninstallable package as installable", () => {
  /**
   * This forbade `npx create-flowcms` and `npm install flowcms` outright, on the
   * grounds that both names were unpublished and unverified — a command that
   * wastes a reader's afternoon. Both are published now, so the rule as written
   * forbade the README from showing the one command it exists to show.
   *
   * The premise is re-anchored on evidence the repository actually carries: a
   * dated version heading in the changelog means a release happened. Before the
   * first one, no install instructions at all — the original rule, unchanged.
   * After it, they are expected.
   *
   * The VERSION-PIN half of this question — that an instruction must not name a
   * version this tree has not reached — belongs to
   * `tests/release/releaseProcess.test.ts` and is deliberately not duplicated
   * here. Two implementations of one rule is two answers to one question.
   */
  const released = /^## \[\d+\.\d+\.\d+\][^\n]*\d{4}-\d{2}-\d{2}/m.test(read("CHANGELOG.md"))

  it.each(DOCS)("%s", (file) => {
    if (released) return

    // Only fenced COMMAND lines are checked. Prose discussing the published
    // form is how these documents explain themselves, and a rule that forbade
    // the string outright would forbid saying it does not work.
    const offending = read(file)
      .split("\n")
      .filter((line) => /^\s*(?:\$\s*)?(?:npx create-flowcms|npm install flowcms\b)/.test(line))
    expect(offending, `${file} presents an unpublished package as installable`).toEqual([])
  })

  it("Aurora is still never presented as something to install from npm", () => {
    // The one package here that genuinely is not published, and never will be:
    // it carries `"private": true` and is an integration fixture. Any document
    // showing it as an install must say where it actually comes from.
    const aurora = JSON.parse(read("packages/flowcms-theme-aurora/package.json"))
    expect(aurora.private, "Aurora is no longer private — this rule assumed it was").toBe(true)

    for (const file of DOCS) {
      const source = read(file)
      const shown = source
        .split("\n")
        .some((line) => /^\s*(?:\$\s*)?npm install @example\/flowcms-theme-aurora/.test(line))
      if (!shown) continue
      expect(
        /not published|is a fixture|packed tarball|from a path/i.test(source),
        `${file} installs the Aurora fixture without saying it is not on npm`,
      ).toBe(true)
    }
  })
})

describe("public documents only point at documents that exist", () => {
  // These documents deliberately cross-reference rather than restate, which
  // only works if the pointers resolve. Phase 9.10E moved every internal
  // document out of the public tree into the gitignored `dev-docs/`; this is
  // what stops a public document being left pointing at one of them, and what
  // will catch the same mistake next time.
  const linked = (file: string) =>
    [...read(file).matchAll(/`(docs\/[a-z0-9/_-]+\.md)`/g)].map((m) => m[1])

  it.each(DOCS)("%s", (file) => {
    const missing = [...new Set(linked(file))].filter((p) => !existsSync(join(ROOT, p)))
    expect(missing, `${file} points at documents that are not on disk`).toEqual([])
  })

  it("the distribution and docker documents are still cross-referenced", () => {
    const all = new Set(DOCS.flatMap(linked))
    expect(all).toContain("docs/distribution/package-managers.md")
    expect(all).toContain("docs/distribution/create-flowcms.md")
    expect(all).toContain("docs/docker.md")
  })
})

describe("no public document points into the private documentation tree", () => {
  // `dev-docs/` is gitignored and never published, so a public document naming
  // one of its files sends a reader to a 404 in the public repository. The
  // paths below are the ones that USED to be public and are the ones a stale
  // sentence is most likely to still name.
  const PRIVATE = [
    /\bdev-docs\//,
    /docs\/implementation-reports/,
    /docs\/superpowers/,
    /docs\/release\//,
    /\bPROJECT_DOCUMENTATION\.md/,
    /`CLAUDE\.md`/,
    /`AGENTS\.md`/,
    /license-decision\.md/,
    /release-metadata\.md/,
  ]

  it.each(DOCS)("%s", (file) => {
    const source = read(file)
    const hits = PRIVATE.filter((pattern) => pattern.test(source)).map(String)
    expect(hits, `${file} references private documentation`).toEqual([])
  })
})
