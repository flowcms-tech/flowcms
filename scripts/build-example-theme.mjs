#!/usr/bin/env node
/**
 * Builds the Aurora example theme package.
 *
 * WHY THIS EXISTS AS A SEPARATE, PLAIN BUILD
 *
 * Aurora is the fixture that proves a third-party theme can be written against
 * the published contract and installed like any other dependency. It only
 * proves that if it is built the way a third-party author would build it: its
 * own tsconfig, no repository path aliases, `flowcms/theme` resolved through
 * node_modules. A shortcut here — compiling it with the app's config, or
 * shipping its raw TypeScript — would make the whole proof circular.
 *
 * The audit below is the interesting part. A theme may import `flowcms/theme`,
 * `react` and its own files. Anything else in the EMITTED output means the
 * theme reached somewhere a published package could not, and the failure would
 * otherwise surface in a stranger's project rather than in this build.
 */

import { rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { ROOT, compile, addJsExtensions, auditArtifact, report, walk } from "./lib/packageEmit.mjs"

const PACKAGE_DIR = join(ROOT, "packages", "flowcms-theme-aurora")
const DIST = join(PACKAGE_DIR, "dist")

rmSync(DIST, { recursive: true, force: true })

console.log("[aurora] tsc -p packages/flowcms-theme-aurora/tsconfig.json")
compile(join("packages", "flowcms-theme-aurora", "tsconfig.json"))
console.log(`[aurora] rewrote relative specifiers in ${addJsExtensions(DIST)} file(s)`)

const problems = auditArtifact({
  packageDir: PACKAGE_DIR,
  dist: DIST,
  allowedBare: new Set(["flowcms/theme", "react", "react/jsx-runtime", "react/jsx-dev-runtime"]),
})

/**
 * The screenshot is part of the artifact, not part of the repository.
 *
 * `packages/flowcms-theme-aurora/screenshot.png` is listed in the package's
 * `files` allowlist and re-exported as a subpath, so an installed copy carries
 * it under node_modules. The application then imports it statically in
 * `src/Themes/packages.ts`, which is what puts it through Next's asset pipeline
 * and into the standalone output — see docs/distribution/packages.md.
 */
if (!existsSync(join(PACKAGE_DIR, "screenshot.png"))) {
  problems.push("screenshot.png is missing — the package asset proof depends on it")
}

report("aurora", problems, `${walk(DIST).length} files in packages/flowcms-theme-aurora/dist`)
