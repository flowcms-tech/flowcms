#!/usr/bin/env node
/**
 * THE PACKAGE-THEME BUILD PROOF.
 *
 * `docs/distribution/packages.md`, "What future CI must run", names two gates
 * that only a real production build can answer. This is that script.
 *
 *   1. STANDALONE TRACING — `.next/standalone/node_modules/@example/…` exists.
 *      Next's file tracer decides what reaches the standalone output. A theme
 *      installed as a package but not traced is a theme that is present in
 *      development, present in the build, and absent from the production image
 *      — which is precisely why there is deliberately no `installed_themes`
 *      table and no runtime directory scan.
 *
 *   2. TAILWIND REACH — the built CSS contains `letter-spacing:.4375em`.
 *      Aurora's `tracking-[0.4375em]` is an arbitrary-value utility that
 *      appears nowhere else in FlowCMS, so its presence in the production
 *      stylesheet is proof that Tailwind read source inside a node_modules
 *      package rather than only the application's own `src/`.
 *
 * THE LEADING ZERO IS THE WHOLE POINT OF THIS SCRIPT EXISTING
 *
 * The minifier writes `.4375em`, not `0.4375em`. Phase 7 grepped for
 * `0.4375em`, found nothing, and concluded — across four builds and a written
 * design decision — that Turbopack ignores `@source`. It does not. A false
 * negative that survives that long is not a grep anybody should retype from
 * memory into a workflow file, so it lives here with the reason attached, and
 * both spellings are accepted.
 *
 * PREREQUISITE: a completed production build with the integration themes
 * registered:
 *
 *   FLOWCMS_INTEGRATION_THEMES=1 npm run build
 *
 * It asserts the build happened rather than skipping. A theme-tracing gate that
 * silently passes when `.next` is absent is a green check attached to nothing.
 *
 * Usage:
 *   node scripts/ci/assert-theme-tracing.mjs
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const NEXT = join(ROOT, ".next")
const STANDALONE = join(NEXT, "standalone")

const THEME_PACKAGE = join("node_modules", "@example", "flowcms-theme-aurora")

/**
 * Both spellings. See the header — the minified one is the one that is actually
 * emitted, and the unminified one is accepted so a future non-minifying build
 * mode does not report a false failure.
 */
export const TAILWIND_MARKERS = ["letter-spacing:.4375em", "letter-spacing:0.4375em"]

export function findMarker(css, markers = TAILWIND_MARKERS) {
  return markers.find((m) => css.includes(m)) ?? null
}

const failures = []
const check = (label, ok, detail = "") => {
  if (ok) {
    console.log(`  ok    ${label}`)
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`)
    failures.push(label)
  }
}

// ---------------------------------------------------------------------------
// 0. The build has to have happened
// ---------------------------------------------------------------------------

if (!existsSync(NEXT)) {
  console.error(
    "No .next directory.\n\n" +
      "This script reads a completed production build. Run:\n" +
      "  FLOWCMS_INTEGRATION_THEMES=1 npm run build\n",
  )
  process.exit(1)
}

if (!existsSync(STANDALONE)) {
  console.error(
    "No .next/standalone directory.\n\n" +
      'next.config.ts sets output: "standalone"; its absence means the build did\n' +
      "not complete, or the configuration changed. Either is a failure, not a skip.\n",
  )
  process.exit(1)
}

console.log("=== theme reaches the deployable artifact ===")

/** Every file under `dir`, recursively. */
function filesUnder(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue // a broken link is not this gate's business
    }
    if (stat.isDirectory()) out.push(...filesUnder(full))
    else out.push(full)
  }
  return out
}

/**
 * Runtime strings only Aurora emits.
 *
 * String literals survive minification, which is what makes them usable as a
 * marker when the package has been bundled into a server chunk rather than
 * copied as a directory. They are read from BUILT output only — every path
 * scanned below is build product, never repository source.
 */
const RUNTIME_MARKERS = [
  "https://example.test/themes/aurora",
  "Show the Aurora banner",
  "Aurora journal",
]

// ---------------------------------------------------------------------------
// 1. Aurora's runtime code is IN the deployable artifact
// ---------------------------------------------------------------------------
//
// WHAT THIS USED TO ASSERT, AND WHY THAT BECAME WRONG.
//
// It required the literal directory
// `.next/standalone/node_modules/@example/flowcms-theme-aurora`. That was a
// true invariant when Next's tracer externalised every package it copied. Under
// Next 16.3.2 with Turbopack a statically imported package is legitimately
// BUNDLED into the server chunks instead, so the directory can be absent from a
// completely correct build — the gate was measuring an implementation detail of
// the bundler rather than the property anyone depends on.
//
// The property anyone depends on is: Aurora's built runtime code ships inside
// the artifact you deploy. Both layouts satisfy it, and both are accepted;
// neither is assumed.

const externalised = join(STANDALONE, THEME_PACKAGE)
const externalisedOk = existsSync(join(externalised, "dist", "index.js"))

const serverRoots = [join(STANDALONE, ".next", "server"), join(NEXT, "server"), STANDALONE]
let bundledIn = null
let bundledMarker = null

outer: for (const root of serverRoots) {
  for (const file of filesUnder(root)) {
    if (!/\.(js|mjs|cjs|json)$/.test(file)) continue
    let text
    try {
      text = readFileSync(file, "utf8")
    } catch {
      continue
    }
    const hit = RUNTIME_MARKERS.find((m) => text.includes(m))
    if (hit) {
      bundledIn = file
      bundledMarker = hit
      break outer
    }
  }
}

check(
  "Aurora's runtime code is present in the deployable artifact",
  externalisedOk || bundledIn !== null,
  "neither an externalised package directory nor a bundled runtime marker was found under .next/standalone",
)

if (externalisedOk) {
  console.log(`        externalised — ${THEME_PACKAGE}/dist/index.js`)
}
if (bundledIn) {
  console.log(`        bundled — matched "${bundledMarker}" in ${bundledIn.slice(ROOT.length + 1)}`)
}

// ---------------------------------------------------------------------------
// 2. Tailwind read the package's source
// ---------------------------------------------------------------------------

console.log("\n=== Tailwind reach ===")

/**
 * Every emitted stylesheet, found by WALKING the build rather than by guessing
 * where it lives.
 *
 * This used to read exactly two directories — `.next/static/css` and its
 * standalone twin. Next 16.3.2 with Turbopack does not always put CSS there,
 * and the gate reported "the build emitted at least one stylesheet: FAIL"
 * against a build that had emitted several. A hard-coded output path is a
 * guess about a bundler's internals; the invariant is that the CSS exists in
 * the build, not that it sits at one address.
 */
function cssFiles() {
  return filesUnder(NEXT).filter((f) => f.endsWith(".css"))
}

const sheets = cssFiles()
check("the build emitted at least one stylesheet", sheets.length > 0)

let marker = null
let where = null
for (const sheet of sheets) {
  const found = findMarker(readFileSync(sheet, "utf8"))
  if (found) {
    marker = found
    where = sheet
    break
  }
}

check(
  "the production CSS contains Aurora's tracking-[0.4375em] utility",
  marker !== null,
  "Tailwind did not read source inside node_modules — check the @source directive in src/app/globals.css",
)

if (marker) {
  console.log(`        matched "${marker}" in ${where.slice(ROOT.length + 1)}`)
}

// ---------------------------------------------------------------------------

if (failures.length) {
  console.error(`\n${failures.length} package-theme build gate(s) failed.\n`)
  process.exit(1)
}

console.log("\nPackage-theme build gates passed.\n")
