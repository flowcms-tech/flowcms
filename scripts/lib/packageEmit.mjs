/**
 * The three steps every FlowCMS package build shares: compile, make the emitted
 * specifiers runnable, audit what came out.
 *
 * Two packages use this — the published `flowcms` API and the `aurora` example
 * theme — and they must be built the same way for the proof to mean anything.
 * If the example theme were packaged by a different route than a real theme
 * author's, it would stop being evidence that a real theme author can do this.
 */

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, relative, dirname } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

export function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

/**
 * Run tsc against a project file.
 *
 * TypeScript's own entry point rather than the `.bin` shim: which shims exist
 * depends on whether npm, bun or pnpm did the install, and these scripts have
 * to run identically on a contributor's machine and inside the Docker builder.
 */
export function compile(tsconfigPath) {
  const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc")
  execFileSync(process.execPath, [tsc, "-p", join(ROOT, tsconfigPath)], {
    cwd: ROOT,
    stdio: "inherit",
  })
}

/**
 * Matches the specifier in `from "…"`, `import("…")` and `export * from "…"`,
 * capturing only RELATIVE ones.
 *
 * Bare specifiers are resolved by Node's package algorithm and must survive
 * exactly as written, which is why the capture group starts at a dot.
 */
export const RELATIVE_SPECIFIER =
  /(\bfrom\s*["']|\bimport\s*\(\s*["']|\bexport\s+\*\s+from\s*["'])(\.[^"']*)(["'])/g

/** Every bare specifier in a file, whether relative or not. */
export const ANY_SPECIFIER = /\bfrom\s*["']([^."'][^"']*)["']/g

/**
 * `from "./views"` becomes `from "./views.js"`, in both `.js` and `.d.ts`.
 *
 * The one thing tsc will not do for us. Under `moduleResolution: "bundler"` it
 * copies `./views` through verbatim, which Node's ESM resolver rejects — and a
 * package that only works inside a bundler is a package that cannot be smoke
 * tested, which is how a broken artifact ships.
 *
 * OUTPUT ONLY. The repository's own sources stay extensionless, because Next
 * and Vitest compile the same files under bundler resolution where
 * extensionless is the convention. Rewriting the sources to satisfy the
 * package build would put the tail in charge of the dog.
 *
 * Idempotent: a specifier that already carries an extension is left alone.
 */
export function addJsExtensions(dist) {
  let rewritten = 0
  for (const file of walk(dist)) {
    if (!/\.(js|d\.ts)$/.test(file)) continue
    const before = readFileSync(file, "utf8")
    const after = before.replace(RELATIVE_SPECIFIER, (match, head, spec, tail) =>
      /\.(js|json|css)$/.test(spec) ? match : `${head}${spec}.js${tail}`,
    )
    if (after !== before) {
      writeFileSync(file, after)
      rewritten += 1
    }
  }
  return rewritten
}

/**
 * Source with comments removed.
 *
 * The audit must read CODE. Emitted declarations deliberately keep their
 * authoring comments — they are what a theme author sees on hover, and the only
 * documentation shipped with the types — and several of them name FlowCMS's own
 * layout while explaining why a boundary exists. A sentence mentioning
 * `src/Themes/validation` cannot break a consumer's install; an import
 * specifier can. Scanning the prose would fail the build for the documentation,
 * and teach whoever hit it to delete the comments.
 */
export function stripComments(source) {
  const BLOCK = new RegExp("/\\*[\\s\\S]*?\\*/", "g")
  const LINE = new RegExp("(^|[^:])//.*$", "gm")
  return source.replace(BLOCK, "").replace(LINE, "$1")
}

/**
 * Paths that must never appear in shipped output.
 *
 * Each one means the same failure: something in the package refers to a place
 * only this repository has. `@/` is the application's alias; the `src/…`
 * entries are what a half-finished move leaves behind. Both work perfectly
 * here and fail on the consumer's first `npm install`, which is the single most
 * common way a monorepo package ships broken.
 */
export const FORBIDDEN_PATHS = [
  ["@/", "the application's path alias — unresolvable outside this repository"],
  ["src/Themes", "an internal source path"],
  ["src/Framework", "an internal source path"],
  ["src/Modules", "an internal source path"],
  ["src/app", "an internal source path"],
  ["src/db", "an internal source path"],
  ["src/components", "an internal source path"],
  ["src/lib", "an internal source path"],
]

const NODE_TYPE = new RegExp("\\b(NodeJS|Buffer|process)\\b")

/**
 * Everything that must be true of an emitted package, as a list of problems.
 *
 * Run as part of the BUILD rather than as a test that happens later, because
 * this is the feedback that is worthless once the artifact is published.
 */
export function auditArtifact({ packageDir, dist, allowedBare, entry = "index" }) {
  const problems = []
  const emitted = walk(dist)

  if (emitted.length === 0) problems.push("tsc emitted nothing")
  for (const required of [`${entry}.js`, `${entry}.d.ts`]) {
    if (!existsSync(join(dist, required))) problems.push(`dist/${required} is missing`)
  }

  for (const file of emitted) {
    const rel = relative(packageDir, file).split("\\").join("/")
    const source = stripComments(readFileSync(file, "utf8"))

    for (const [needle, why] of FORBIDDEN_PATHS) {
      if (source.includes(needle)) problems.push(`${rel} contains "${needle}" — ${why}`)
    }

    // The packages compile against @types/node where they genuinely need it
    // (`publicImageUrl` reads NEXT_PUBLIC_BASE_URL). None of that may reach a
    // consumer: a declaration naming a Node type would make @types/node a
    // silent peer requirement of writing a theme.
    if (rel.endsWith(".d.ts") && NODE_TYPE.test(source)) {
      problems.push(`${rel} references a Node type or global — @types/node must not leak into the public API`)
    }

    for (const match of source.matchAll(ANY_SPECIFIER)) {
      if (!allowedBare.has(match[1])) {
        problems.push(`${rel} imports "${match[1]}", which this package does not declare`)
      }
    }
  }

  return problems
}

export function report(name, problems, summary) {
  if (problems.length > 0) {
    console.error(`\n[${name}] the artifact is not publishable:\n`)
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error("")
    process.exit(1)
  }
  console.log(`[${name}] ok — ${summary}`)
}
