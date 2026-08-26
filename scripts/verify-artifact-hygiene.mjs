#!/usr/bin/env node
/**
 * THE ARTIFACT LEAK GATE.
 *
 * Answers one question about every package this repository can publish: would
 * `npm publish` put something in a stranger's node_modules that should never
 * have left this machine?
 *
 * It inspects the packed FILE LIST — `npm pack --dry-run --json`, which is what
 * npm would actually upload — and then, for text files only, whether any of
 * them embeds a path from the machine that built it.
 *
 * TWO RULES THIS SCRIPT MUST NEVER BREAK
 *
 * 1. It reports NAMES, never CONTENTS. A leak gate that prints the secret it
 *    found has published the secret into the CI log, where it is more durable
 *    and more widely readable than the file was. Every message here names the
 *    file and the rule; nothing here can print a matched line, and the content
 *    scan is skipped entirely for any file that already failed a name rule.
 *    `data-info.txt` is the file that motivated the ordering — it is named in
 *    the deny list and is therefore never opened.
 * 2. It is a DENY list layered under an ALLOW list, not a deny list alone. The
 *    allowlist is what actually holds: a stray file fails because it is not on
 *    the allowlist, and the deny rules exist to say WHY a specific class of
 *    stray is dangerous, in a message a maintainer can act on. A deny list on
 *    its own is a denial of the things somebody remembered.
 *
 * WHY THIS EXISTS ALONGSIDE `verify-package-consumer.mjs`
 *
 * The consumer proof also audits tarball contents, and that overlap is
 * deliberate rather than accidental. The consumer proof builds, packs, installs
 * into a temp directory, typechecks and renders — minutes of work, so it runs
 * on main and on a release. This runs in seconds against `--dry-run` output, so
 * it can run on every pull request. Duplicated coverage on the cheap gate is
 * the point; a hygiene rule that only runs before a release is a rule that
 * finds its first violation at the worst possible moment.
 *
 * REQUIRES THE BUILDS. `packages/flowcms/dist`, the Aurora `dist` and the
 * create-flowcms `template/` are generated. Without them npm packs a manifest
 * describing nothing and this script would report a clean bill of health for an
 * artifact that does not exist. It refuses to run instead.
 *
 * Usage:
 *   node scripts/verify-artifact-hygiene.mjs              every publishable package
 *   node scripts/verify-artifact-hygiene.mjs packages/flowcms
 *   node scripts/verify-artifact-hygiene.mjs --json       machine-readable summary
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join, dirname, extname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

// ---------------------------------------------------------------------------
// The packages, and what each is allowed to ship
// ---------------------------------------------------------------------------

/**
 * `allow` is the whole shipping manifest, expressed as one regular expression
 * per package. Anything a package emits that this does not match is a stray,
 * reported whether or not a deny rule also names it.
 *
 * `envExampleUnder` is the single deliberate exception in the repository, and
 * it is worth stating plainly because the reflex answer is wrong:
 *
 *   `.env.example` MUST ship inside create-flowcms, and ONLY inside its
 *   `template/` directory.
 *
 * A generated project without `.env.example` has no documentation for the
 * variables it needs, and `docs/docker.md` tells the operator to copy it. It
 * carries no values — every secret in it is a refused placeholder, which
 * `Framework/Config/deploymentSecret.ts` rejects at startup by design. It is
 * documentation shaped like a config file.
 *
 * `flowcms` and the Aurora theme are libraries. Neither has any use for one,
 * so for those two `.env.example` is treated exactly like `.env`.
 */
export const PACKAGES = [
  {
    name: "flowcms",
    dir: "packages/flowcms",
    requires: ["dist/index.js", "dist/index.d.ts"],
    requiresHint: "node scripts/build-package.mjs   (or npm run build:packages)",
    allow: /^(dist\/|package\.json$|README\.md$)/,
    envExampleUnder: null,
    appSourceUnder: null,
  },
  {
    name: "@example/flowcms-theme-aurora",
    dir: "packages/flowcms-theme-aurora",
    requires: ["dist/index.js"],
    requiresHint: "node scripts/build-example-theme.mjs   (or npm run build:packages)",
    allow: /^(dist\/|package\.json$|README\.md$|screenshot\.png$)/,
    envExampleUnder: null,
    appSourceUnder: null,
  },
  {
    name: "create-flowcms",
    dir: "packages/create-flowcms",
    requires: ["template.json", "template"],
    requiresHint: "node scripts/build-create-flowcms.mjs   (or npm run build:template)",
    allow: /^(bin\/|src\/|template\/|template\.json$|package\.json$|README\.md$)/,
    envExampleUnder: /^template\//,
    // `template/` is a whole Next application shipped as source, not a library.
    // See LIBRARY_SHAPED_RULES: `internal-alias` and `repo-tooling` do not
    // apply inside it, and every other rule still does.
    appSourceUnder: /^template\//,
    // The example theme is a repository fixture. A generated project that
    // carried it would ship a second theme nobody asked for, and would make
    // FLOWCMS_INTEGRATION_THEMES reachable in somebody's production install.
    extraDeny: [
      { id: "example-fixture", pattern: /flowcms-theme-aurora/, why: "the example theme fixture" },
    ],
  },
]

// ---------------------------------------------------------------------------
// Deny rules — file NAMES and paths only
// ---------------------------------------------------------------------------

/**
 * Ordered most-specific first, because only the first match is reported and the
 * first match is what the message says. `.env.example` has to be considered
 * before the general `.env` rule or the exception above could never apply.
 */
export const DENY_RULES = [
  {
    id: "env-example",
    pattern: /(^|\/)\.env\.example$/,
    why: "an environment example outside the one directory allowed to carry one",
  },
  {
    id: "env-file",
    pattern: /(^|\/)\.env($|\.|-)/,
    why: "an environment file — real values, or a file shaped like one",
  },
  {
    id: "local-credentials",
    // Named, never opened. The name rule runs before the content scan, and the
    // content scan skips anything a name rule already caught.
    pattern: /(^|\/)data-info(\.|$)/,
    why: "the local credentials scratch file",
  },
  {
    id: "credential-file",
    // The extension group refuses SOURCE extensions, deliberately. A module
    // named `secrets.mjs` is code that GENERATES secrets — `create-flowcms`
    // has two — and a name-based rule cannot tell that from a file that holds
    // them. Without the lookahead this flagged its own secret generator, which
    // is the kind of false positive that gets a gate switched off.
    // `secrets.json` / `credentials.yaml` are still caught: the lookahead is
    // anchored, so only an exact source extension is exempt.
    pattern:
      /(^|\/)(\.npmrc|\.netrc|_netrc|\.pgpass|credentials?|secrets?)(\.(?!(?:mjs|cjs|jsx?|tsx?)$)[a-z0-9]+)?$/i,
    why: "a credentials file",
  },
  {
    id: "credential-ish",
    pattern: /credential/i,
    why: "a file whose name says it holds credentials",
  },
  {
    id: "private-key",
    pattern:
      /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)($|\.)|\.(pem|key|p12|pfx|jks|keystore|ppk|asc|gpg)$/i,
    why: "a private key or certificate material",
  },
  {
    id: "database",
    pattern: /\.(db|db-shm|db-wal|sqlite|sqlite3)($|-)/i,
    why: "a database file — somebody's actual site content",
  },
  {
    id: "vcs",
    // The trailing slash matters: `.gitignore` is a legitimate template file
    // (npm renames it in transit, which is exactly why create-flowcms ships it
    // deliberately). Repository HISTORY is what must never ship.
    pattern: /(^|\/)\.git\//,
    why: "repository history",
  },
  {
    id: "node-modules",
    pattern: /(^|\/)node_modules\//,
    why: "installed dependencies",
  },
  {
    id: "nested-tarball",
    pattern: /\.tgz$/,
    why: "a nested package tarball",
  },
  {
    id: "build-state",
    pattern: /(^|\/)(\.next|out|coverage|\.turbo|\.vercel)\/|\.tsbuildinfo$/,
    why: "build or coverage output from the machine that packed this",
  },
  {
    id: "agent-tooling",
    pattern: /(^|\/)\.(claude|cursor|codex|impeccable|superpowers|idea|vscode|husky)\//,
    why: "local editor or agent tooling",
  },
  {
    id: "internal-notes",
    pattern: /(^|\/)(AGENTS|CLAUDE|PROJECT_DOCUMENTATION|DESIGN|PRODUCT|MAINTAINERS?|TODO|NOTES)\.md$/i,
    why: "a maintainer-facing internal document",
  },
  {
    id: "internal-docs",
    pattern: /(^|\/)(dev-docs|superpowers|implementation-reports?|specs?|plans?)\//i,
    why: "internal design notes, plans or implementation reports",
  },
  {
    id: "repo-tooling",
    pattern: /(^|\/)(publish-guard|vitest\.config|eslint\.config|drizzle\.config)/,
    why: "repository tooling, which has no meaning inside an installed package",
  },
  {
    id: "test-suite",
    pattern: /(^|\/)tests?\//,
    why: "the repository test suite",
  },
  {
    id: "log",
    pattern: /\.log$/,
    why: "a log file from the machine that packed this",
  },
]

/**
 * Classify one package's packed file list.
 *
 * Pure, exported and separately unit-tested: the deny list is the part worth
 * testing, and testing it should not require npm, a build, or a filesystem.
 *
 * @param {{ packageName?: string, files: string[], allow?: RegExp | null,
 *           envExampleUnder?: RegExp | null, extraDeny?: Array<object> }} input
 * @returns {{ violations: Array<{file: string, rule: string, why: string}>,
 *             strays: string[] }}
 */
/**
 * Rules that mean "this does not belong in an INSTALLED LIBRARY", and nothing
 * stronger than that.
 *
 * `create-flowcms` does not ship a library. It ships a whole Next application
 * as source, which the CLI copies onto disk and the operator then installs and
 * builds. In that subtree:
 *
 *   - `@/…` is not an unresolved alias, it is the generated project's own
 *     `paths` entry, resolved by the tsconfig shipped beside it;
 *   - `eslint.config.mjs` is not repository tooling, it is what the generated
 *     project's own `lint` script runs.
 *
 * Applied to `template/**` these two produced 464 failures on this gate's first
 * execution — every one of them a false positive, and enough noise to bury the
 * two real findings underneath. Scoping them off is not a loosening: every
 * credential, key, database, VCS, node_modules and build-state rule still
 * applies to every file in every package, which is what this gate is for.
 */
const LIBRARY_SHAPED_RULES = new Set(["internal-alias", "repo-tooling"])

/**
 * @param {string} file
 * @param {RegExp | null} appSourceUnder
 * @param {{ id: string }} rule
 */
function ruleAppliesTo(file, appSourceUnder, rule) {
  if (!appSourceUnder || !appSourceUnder.test(file)) return true
  return !LIBRARY_SHAPED_RULES.has(rule.id)
}

export function classifyPackedFiles({
  packageName = "",
  files,
  allow = null,
  envExampleUnder = null,
  appSourceUnder = null,
  extraDeny = [],
}) {
  const rules = [...extraDeny, ...DENY_RULES]
  const violations = []

  for (const file of files) {
    if (envExampleUnder && /(^|\/)\.env\.example$/.test(file) && envExampleUnder.test(file)) {
      // The one deliberate exception. See PACKAGES.envExampleUnder.
      continue
    }
    const hit = rules.find(
      (rule) => ruleAppliesTo(file, appSourceUnder, rule) && rule.pattern.test(file),
    )
    if (hit) violations.push({ file, rule: hit.id, why: hit.why, package: packageName })
  }

  const strays = allow ? files.filter((f) => !allow.test(f)) : []
  return { violations, strays }
}

// ---------------------------------------------------------------------------
// Content rules — build-machine paths embedded in shipped text
// ---------------------------------------------------------------------------

/**
 * A packed file can be perfectly named and still leak. A declaration file that
 * says `import("C:/Users/someone/projects/flowcms/src/Themes/contract")` names
 * a directory on the maintainer's laptop, resolves nowhere for a consumer, and
 * tells every reader the maintainer's username and project layout.
 *
 * Only the RULE ID and the FILE NAME are ever reported. The matched text is
 * never captured, never stored and never printed — a leak gate that quotes the
 * leak has republished it into the CI log.
 */
export const CONTENT_RULES = [
  {
    id: "windows-user-path",
    // `[\\/]+`, not `[\\/]`. A Windows path embedded in shipped TEXT is usually
    // escaped — `"C:\\Users\\someone\\project"` inside a JS string literal, a
    // JSON value or a source map — so the separator arrives as TWO characters.
    // With a single-character class the rule matched the first backslash, then
    // looked for `Users` and found `\Users`, and the leak went unreported. That
    // is the shape this gate exists to catch, and it was the shape it missed:
    // the forward-slash spelling passed while the far more common escaped one
    // did not. Found by `tests/ci/artifactHygiene.test.ts` on its first run.
    pattern: /[A-Za-z]:[\\/]+(?:Users|Program Files|home)[\\/]+/,
    why: "an absolute Windows path from the machine that built this",
  },
  {
    id: "posix-home-path",
    pattern: /(?:^|[\s"'(=:,[])\/(?:home|Users)\/[A-Za-z0-9._-]+\//,
    why: "an absolute home-directory path from the machine that built this",
  },
  {
    id: "ci-workspace-path",
    pattern: /\/home\/runner\/work\//,
    why: "an absolute GitHub Actions workspace path",
  },
  {
    id: "internal-alias",
    pattern: /["'(]@\/(?:Themes|Framework|Modules|db|app|components)\//,
    why: "an unresolved @/ internal alias — no consumer can resolve it",
  },
]

/** Text-ish extensions only. Binary files are never opened. */
const TEXT_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx",
  ".ts", ".mts", ".cts", ".tsx",
  ".json", ".map",
  ".md", ".txt",
  ".css", ".scss", ".html",
  ".yml", ".yaml",
  ".sh", ".example", "",
])

const MAX_SCANNED_BYTES = 2 * 1024 * 1024

/**
 * Scan text for embedded build-machine paths.
 *
 * @returns {string[]} rule ids that matched — never the matched text.
 */
export function scanTextForLeaks(text, rules = CONTENT_RULES) {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.id)
}

function contentViolations(packageDir, files, alreadyFlagged, appSourceUnder = null) {
  const out = []
  for (const file of files) {
    if (alreadyFlagged.has(file)) continue // never open a file a name rule caught
    if (!TEXT_EXTENSIONS.has(extname(file))) continue
    const abs = join(packageDir, file)
    if (!existsSync(abs)) continue
    let stat
    try {
      stat = statSync(abs)
    } catch {
      continue
    }
    if (!stat.isFile() || stat.size > MAX_SCANNED_BYTES) continue
    let text
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    for (const id of scanTextForLeaks(text)) {
      const rule = CONTENT_RULES.find((r) => r.id === id)
      // Same scoping as the name rules: inside a shipped application source
      // tree, `@/…` is the generated project's own alias, not an unresolvable
      // one. The build-machine PATH rules are unaffected and still apply — an
      // absolute `C:\Users\…` baked into template source is a leak wherever it
      // appears.
      if (!ruleAppliesTo(file, appSourceUnder, rule)) continue
      out.push({ file, rule: rule.id, why: rule.why })
    }
    text = null
  }
  return out
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const npm = process.platform === "win32" ? "npm.cmd" : "npm"

export function packedFileList(packageDir) {
  const out = execFileSync(npm, ["pack", "--dry-run", "--json"], {
    cwd: packageDir,
    encoding: "utf8",
    shell: process.platform === "win32",
    // stdout captured, stderr inherited: npm writes its progress banner to
    // stderr, and a JSON parse of the two combined fails for a reason that has
    // nothing to do with hygiene.
    stdio: ["ignore", "pipe", "inherit"],
  })
  const parsed = JSON.parse(out)
  return parsed[0].files.map((f) => f.path)
}

function main(argv) {
  const json = argv.includes("--json")
  const selectors = argv.filter((a) => !a.startsWith("--"))
  const selected = selectors.length
    ? PACKAGES.filter((p) =>
        selectors.some((s) => p.dir.endsWith(s.replace(/\\/g, "/")) || p.name === s),
      )
    : PACKAGES

  if (selected.length === 0) {
    console.error(`No publishable package matched: ${selectors.join(", ")}`)
    return 2
  }

  const report = []
  let failed = false

  for (const pkg of selected) {
    const dir = join(ROOT, pkg.dir)
    if (!existsSync(dir)) {
      console.error(`\nFAIL  ${pkg.name}: ${pkg.dir} does not exist`)
      failed = true
      continue
    }

    const missing = (pkg.requires ?? []).filter((r) => !existsSync(join(dir, r)))
    if (missing.length) {
      // Refuse, do not skip. A hygiene gate that reports "clean" for an
      // artifact that was never built is worse than no gate: it is a green
      // check mark attached to nothing.
      console.error(
        `\nFAIL  ${pkg.name}: not built — missing ${missing.join(", ")}\n` +
          `      run: ${pkg.requiresHint}`,
      )
      failed = true
      continue
    }

    const files = packedFileList(dir)
    const { violations, strays } = classifyPackedFiles({
      packageName: pkg.name,
      files,
      allow: pkg.allow,
      envExampleUnder: pkg.envExampleUnder,
      appSourceUnder: pkg.appSourceUnder ?? null,
      extraDeny: pkg.extraDeny ?? [],
    })

    const flagged = new Set(violations.map((v) => v.file))
    const leaks = contentViolations(dir, files, flagged, pkg.appSourceUnder ?? null)

    const entry = {
      package: pkg.name,
      dir: pkg.dir,
      fileCount: files.length,
      violations,
      strays,
      leaks,
      ok: violations.length === 0 && strays.length === 0 && leaks.length === 0,
    }
    report.push(entry)
    if (!entry.ok) failed = true

    if (!json) {
      console.log(`\n=== ${pkg.name} (${pkg.dir}) — ${files.length} packed files ===`)
      if (entry.ok) {
        console.log("  ok    no prohibited path, no stray file, no embedded build-machine path")
      } else {
        for (const v of violations) console.log(`  FAIL  ${v.file}  [${v.rule}] ${v.why}`)
        for (const s of strays) {
          if (!flagged.has(s)) {
            console.log(`  FAIL  ${s}  [not-allowlisted] not on this package's shipping allowlist`)
          }
        }
        for (const l of leaks) console.log(`  FAIL  ${l.file}  [${l.rule}] ${l.why}`)
      }
    }
  }

  if (json) console.log(JSON.stringify({ ok: !failed, packages: report }, null, 2))

  if (failed) {
    console.error(
      "\nArtifact hygiene FAILED. Nothing above prints file contents, on purpose:\n" +
        "open the named files yourself, decide whether each belongs in a published\n" +
        "package, and fix it by narrowing that package's `files` allowlist rather\n" +
        "than by loosening a rule here.\n",
    )
    return 1
  }

  console.log("\nArtifact hygiene passed for every selected package.\n")
  return 0
}

// Importable for tests; only the direct invocation runs npm.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)))
}
