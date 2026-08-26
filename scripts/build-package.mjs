#!/usr/bin/env node
/**
 * Builds the published `flowcms` package from the theme contract.
 *
 * WHAT IT PRODUCES
 *
 *   packages/flowcms/dist/index.js      the ESM entry behind `flowcms/theme`
 *   packages/flowcms/dist/index.d.ts    its declarations
 *   packages/flowcms/dist/**            the contract's own modules, relative-linked
 *
 * WHY tsc AND NOTHING ELSE
 *
 * Because it can be. Phase 7.2 made `src/Themes/contract/**` a leaf — it
 * imports `react`, `clsx`, `tailwind-merge` and its own files, and nothing from
 * the application — so there is no graph to bundle and no aliases to rewrite.
 * A bundler here would be a build dependency bought with nothing, and one whose
 * declaration output would still need a second tool.
 */

import { rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  ROOT,
  compile,
  addJsExtensions,
  auditArtifact,
  report,
  walk,
} from "./lib/packageEmit.mjs"

const PACKAGE_DIR = join(ROOT, "packages", "flowcms")
const DIST = join(PACKAGE_DIR, "dist")
const CONTRACT = join(ROOT, "src", "Themes", "contract")

rmSync(DIST, { recursive: true, force: true })

console.log("[flowcms] tsc -p tsconfig.package.json")
compile("tsconfig.package.json")
console.log(`[flowcms] rewrote relative specifiers in ${addJsExtensions(DIST)} file(s)`)

const problems = auditArtifact({
  packageDir: PACKAGE_DIR,
  dist: DIST,
  allowedBare: new Set([
    "react",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "clsx",
    "tailwind-merge",
  ]),
})

/**
 * The package version and FLOWCMS_VERSION are one number.
 *
 * They mean different things — one is what npm resolves, the other is what a
 * theme's `flowcmsCompat` range is evaluated against — but they describe the
 * same release. An artifact published under a number that disagrees with the
 * one it reports at runtime tells theme authors the wrong thing about which
 * FlowCMS they are compatible with, and the disagreement is invisible until
 * somebody's theme is refused.
 *
 * Read from source rather than imported, because this runs before the build
 * that would make it importable.
 */
const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"))
const declared = readFileSync(join(CONTRACT, "version.ts"), "utf8").match(
  /FLOWCMS_VERSION\s*=\s*"([^"]+)"/,
)?.[1]

if (declared !== pkg.version) {
  problems.push(
    `packages/flowcms/package.json says ${pkg.version} but FLOWCMS_VERSION is ${declared}`,
  )
}

report(
  "flowcms",
  problems,
  `${walk(DIST).length} files in packages/flowcms/dist, version ${pkg.version}`,
)
