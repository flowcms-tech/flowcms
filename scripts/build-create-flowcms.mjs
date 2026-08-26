#!/usr/bin/env node
/**
 * Builds the application template that `create-flowcms` carries.
 *
 * WHY THE TEMPLATE IS GENERATED RATHER THAN MAINTAINED
 *
 * A hand-kept copy of an application is a copy that is wrong within a month,
 * and wrong in the way nobody notices: the repository gains a route, a
 * migration, a dependency, and generated projects quietly keep shipping last
 * month's. Building it from the repository means the only thing to keep honest
 * is the manifest — and a manifest is short enough to read.
 *
 * WHAT MAKES IT SAFE
 *
 *   - The manifest is an ALLOWLIST. A file nobody wrote down is absent.
 *   - Every directory, file, exclusion and strip must MATCH SOMETHING. A moved
 *     path fails this build rather than producing a project missing a feature.
 *   - Symlinks are REFUSED, not followed. A generated project containing a link
 *     back into this repository is the one failure this whole phase exists to
 *     prevent, and the tracked tree has none today — so encountering one means
 *     something changed that needs looking at.
 *   - Binary files are copied byte-for-byte. Nothing is read as text except the
 *     four files that carry strip sentinels.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  lstatSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join, dirname, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import {
  DIRECTORIES,
  DROPPED_DEV_DEPENDENCIES,
  DROPPED_SCRIPTS,
  EXCLUDE,
  FILES,
  GENERATED,
  RENAMED,
  REWRITTEN_SCRIPTS,
  STRIPPED,
} from "./lib/templateManifest.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const PACKAGE_DIR = join(ROOT, "packages", "create-flowcms")
const TEMPLATE = join(PACKAGE_DIR, "template")

const problems = []
const rel = (path) => relative(ROOT, path).split(sep).join("/")

// ---------------------------------------------------------------------------
// Strip sentinels
// ---------------------------------------------------------------------------

/**
 * `flowcms:template-strip:start` … `:end`, in whatever comment syntax the file
 * uses. The markers are matched by their TEXT, so `//`, `/* *​/` and `#` all
 * work without the builder knowing which language it is looking at.
 */
const STRIP_BLOCK = new RegExp(
  "^[^\\n]*flowcms:template-strip:start[\\s\\S]*?flowcms:template-strip:end[^\\n]*\\n?",
  "gm",
)

function stripFixtureBlocks(source, path) {
  const matches = source.match(STRIP_BLOCK)
  if (!matches) {
    problems.push(
      `${path} is listed as stripped but contains no flowcms:template-strip block. ` +
        `Either the sentinels were removed, or the entry in templateManifest.mjs is stale.`,
    )
    return source
  }
  const stripped = source.replace(STRIP_BLOCK, "")
  if (stripped.includes("flowcms:template-strip")) {
    problems.push(`${path} still contains a template-strip marker after stripping.`)
  }
  return stripped
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const EXCLUDED = new Set(EXCLUDE.map((entry) => entry.split("/").join(sep)))
const STRIP_SET = new Set(STRIPPED.map((entry) => entry.split("/").join(sep)))
const strippedSeen = new Set()

function isExcluded(relativePath) {
  if (EXCLUDED.has(relativePath)) return true
  // A directory exclusion covers everything under it.
  return [...EXCLUDED].some((entry) => relativePath.startsWith(entry + sep))
}

function copyFile(source, relativePath) {
  const target = join(TEMPLATE, relativePath)
  mkdirSync(dirname(target), { recursive: true })

  if (STRIP_SET.has(relativePath)) {
    strippedSeen.add(relativePath)
    writeFileSync(target, stripFixtureBlocks(readFileSync(source, "utf8"), rel(source)))
    return
  }

  // Byte-for-byte. The template carries PNGs, an ICO and a woff2, and reading
  // any of them as UTF-8 to run a replacement through would corrupt them in a
  // way no test that does not open the file would catch.
  cpSync(source, target)
}

function copyTree(sourceDir, prefix) {
  for (const entry of readdirSync(sourceDir).sort()) {
    const source = join(sourceDir, entry)
    const relativePath = prefix ? join(prefix, entry) : entry
    if (isExcluded(relativePath)) continue

    const stats = lstatSync(source)
    if (stats.isSymbolicLink()) {
      problems.push(`${rel(source)} is a symbolic link; the template must be physically flat.`)
      continue
    }
    if (stats.isDirectory()) copyTree(source, relativePath)
    else copyFile(source, relativePath)
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

rmSync(TEMPLATE, { recursive: true, force: true })
mkdirSync(TEMPLATE, { recursive: true })

for (const directory of DIRECTORIES) {
  const source = join(ROOT, directory.split("/").join(sep))
  if (!existsSync(source)) {
    problems.push(`Manifest names directory "${directory}", which does not exist.`)
    continue
  }
  copyTree(source, directory.split("/").join(sep))
}

for (const file of FILES) {
  const source = join(ROOT, file.split("/").join(sep))
  if (!existsSync(source)) {
    problems.push(`Manifest names file "${file}", which does not exist.`)
    continue
  }
  copyFile(source, file.split("/").join(sep))
}

for (const { from, to } of RENAMED) {
  const source = join(ROOT, from)
  if (!existsSync(source)) {
    problems.push(`Manifest names file "${from}", which does not exist.`)
    continue
  }
  // A renamed file may carry strip sentinels too — .gitignore lists this
  // scaffolder's own build output, which means nothing in a generated project.
  if (STRIP_SET.has(from.split("/").join(sep))) {
    strippedSeen.add(from.split("/").join(sep))
    writeFileSync(join(TEMPLATE, to), stripFixtureBlocks(readFileSync(source, "utf8"), from))
  } else {
    cpSync(source, join(TEMPLATE, to))
  }
}

for (const entry of STRIPPED) {
  const normalized = entry.split("/").join(sep)
  if (!strippedSeen.has(normalized)) {
    problems.push(`Manifest lists "${entry}" as stripped, but it was never copied.`)
  }
}

for (const entry of EXCLUDE) {
  const source = join(ROOT, entry.split("/").join(sep))
  // `packages/flowcms/dist`, the create-flowcms scripts and the TinyMCE assets
  // may legitimately not exist yet on a clean checkout — the last is created by
  // `postinstall`, which `npm ci --ignore-scripts` skips and which the
  // Dockerfile runs explicitly instead. The rest name real things and a stale
  // entry is a manifest that has stopped describing the repository.
  const mayBeAbsent =
    entry.includes("/dist") ||
    entry.includes("create-flowcms") ||
    entry === "public/assets/tinymce"
  if (!existsSync(source) && !mayBeAbsent) {
    problems.push(`Manifest excludes "${entry}", which does not exist. Stale entry?`)
  }
}

// ---------------------------------------------------------------------------
// The generated project's package.json
// ---------------------------------------------------------------------------

const manifestPath = join(TEMPLATE, "package.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))

for (const name of Object.keys(DROPPED_SCRIPTS)) {
  if (!(name in manifest.scripts)) {
    problems.push(`Manifest drops script "${name}", which the application no longer has.`)
  }
  delete manifest.scripts[name]
}
for (const [name, command] of Object.entries(REWRITTEN_SCRIPTS)) {
  if (!(name in manifest.scripts)) {
    problems.push(`Manifest rewrites script "${name}", which the application no longer has.`)
  }
  manifest.scripts[name] = command
}
for (const name of Object.keys(DROPPED_DEV_DEPENDENCIES)) {
  if (!(name in manifest.devDependencies)) {
    problems.push(`Manifest drops devDependency "${name}", which is no longer declared.`)
  }
  delete manifest.devDependencies[name]
}

// The name and version are the generated project's, written by the CLI when it
// knows the destination. Placeholders here would be a value someone could ship.
manifest.name = "flowcms-site"
manifest.version = "0.1.0"
manifest.private = true

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

// ---------------------------------------------------------------------------
// The local flowcms package's manifest
// ---------------------------------------------------------------------------

/**
 * A generated project's copy of `flowcms` is a local `file:` dependency and is
 * never published, so it carries no publish guard — and must not carry a
 * `prepublishOnly` naming one that was excluded, which would be a script
 * pointing at a file that is not there.
 */
const localPackagePath = join(TEMPLATE, "packages", "flowcms", "package.json")
if (existsSync(localPackagePath)) {
  const localPackage = JSON.parse(readFileSync(localPackagePath, "utf8"))
  if (!localPackage.scripts?.prepublishOnly) {
    problems.push("packages/flowcms no longer has a prepublishOnly script to drop. Stale step?")
  }
  delete localPackage.scripts
  writeFileSync(localPackagePath, `${JSON.stringify(localPackage, null, 2)}
`)
} else {
  problems.push("The template has no packages/flowcms/package.json.")
}

// ---------------------------------------------------------------------------
// Generated documents
// ---------------------------------------------------------------------------

for (const file of GENERATED) {
  const source = join(PACKAGE_DIR, "template-files", file)
  if (!existsSync(source)) {
    problems.push(`Generated file "${file}" is missing from packages/create-flowcms/template-files.`)
    continue
  }
  cpSync(source, join(TEMPLATE, file))
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** Nothing matching these may be in the template, whatever the manifest says. */
const FORBIDDEN = [
  [/(^|\/)\.env$/, "a real environment file"],
  [/(^|\/)\.env\.(?!example)/, "a real environment file"],
  [/data-info/, "the local credentials scratch file"],
  [/\.db($|-)/, "a database"],
  [/\.sqlite/, "a database"],
  [/(^|\/)node_modules\//, "installed dependencies"],
  [/(^|\/)\.git\//, "repository history"],
  [/(^|\/)\.claude\//, "local agent tooling"],
  [/(^|\/)\.next\//, "build output"],
  [/superpowers/, "internal planning documents"],
  [/flowcms-theme-aurora/, "the example theme fixture"],
  [/\.tgz$/, "a package tarball"],
  [/(^|\/)tests?\//, "the repository test suite"],
  [/\.pem$/, "a private key"],
  [/\.key$/, "a private key"],
]

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return lstatSync(full).isDirectory()
      ? walk(full, base)
      : [relative(base, full).split(sep).join("/")]
  })
}

const files = existsSync(TEMPLATE) ? walk(TEMPLATE) : []
for (const file of files) {
  for (const [pattern, why] of FORBIDDEN) {
    if (pattern.test(file)) problems.push(`Template contains ${why}: ${file}`)
  }
}

// The strips have to have actually removed the fixture references.
for (const [file, needle] of [
  ["src/Themes/packages.ts", "@example/flowcms-theme-aurora"],
  ["src/Themes/registry.ts", "./integration"],
  ["src/app/globals.css", "@example/flowcms-theme-aurora"],
  ["Dockerfile", "flowcms-theme-aurora"],
  ["Dockerfile", "build-example-theme"],
]) {
  const path = join(TEMPLATE, file.split("/").join(sep))
  if (existsSync(path) && readFileSync(path, "utf8").includes(needle)) {
    problems.push(`${file} still references "${needle}" after stripping.`)
  }
}

if (files.length === 0) problems.push("The template is empty.")
if (!existsSync(join(TEMPLATE, "gitignore"))) problems.push("The template has no ignore file.")
if (!existsSync(join(TEMPLATE, ".env.example"))) problems.push("The template has no .env.example.")

// ---------------------------------------------------------------------------
// Stamp
// ---------------------------------------------------------------------------

const version = readFileSync(join(ROOT, "src/Themes/contract/version.ts"), "utf8").match(
  /FLOWCMS_VERSION\s*=\s*"([^"]+)"/,
)?.[1]

writeFileSync(
  join(PACKAGE_DIR, "template.json"),
  `${JSON.stringify({ templateVersion: version, files: files.length }, null, 2)}\n`,
)

if (problems.length > 0) {
  console.error("\n[create-flowcms] the application template is not usable:\n")
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error("")
  process.exit(1)
}

console.log(`[create-flowcms] ok — ${files.length} template files, FlowCMS ${version}`)
