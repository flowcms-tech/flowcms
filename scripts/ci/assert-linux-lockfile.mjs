#!/usr/bin/env node
/**
 * THE LOCKFILE PLATFORM GATE.
 *
 * npm prunes platform-optional dependencies to the OS that generated the
 * lockfile. A `package-lock.json` written on Windows or macOS silently omits
 * `lightningcss-linux-x64-gnu`, `@next/swc-linux-x64-gnu`,
 * `@napi-rs/canvas-linux-x64-gnu` and `@libsql/linux-x64-gnu` — and the first
 * evidence of that is the Docker image build dying inside Tailwind, several
 * minutes in, with a message about a missing native module that says nothing
 * about lockfiles.
 *
 * `docs/docker.md` records the rule: the lockfile must be
 * generated in a Linux container, in a directory with no `node_modules`. A rule
 * written in a document is a rule somebody breaks on a Friday. This is the same
 * rule, in a form that fails in eight seconds at the top of the pipeline and
 * names the fix.
 *
 * It reads the lockfile as DATA. It installs nothing, and it never needs to —
 * the question is what the lockfile RECORDS, not what this machine can resolve.
 *
 * Usage:
 *   node scripts/ci/assert-linux-lockfile.mjs
 *   node scripts/ci/assert-linux-lockfile.mjs path/to/package-lock.json
 */

import { readFileSync, existsSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/**
 * The linux-x64-gnu binaries the Docker image actually needs, each paired with
 * what breaks when it is missing. Deliberately a short list of things that have
 * failed or would fail loudly, not every optional binary in the tree: a gate
 * nobody can read is a gate nobody maintains.
 *
 * glibc (`-gnu`), not musl: the image is `node:22-bookworm-slim`, Debian, and
 * that choice is itself load-bearing — `@napi-rs/canvas` and `libsql` ship
 * glibc prebuilds and fall back to a source build under musl.
 */
export const REQUIRED_LINUX_PACKAGES = [
  {
    path: "node_modules/lightningcss-linux-x64-gnu",
    breaks: "Tailwind v4 CSS compilation, during `next build` in the image",
  },
  {
    path: "node_modules/@next/swc-linux-x64-gnu",
    breaks: "the Next.js compiler — the build falls back or fails outright",
  },
  {
    path: "node_modules/@napi-rs/canvas-linux-x64-gnu",
    breaks: "the login CAPTCHA, which is rendered with @napi-rs/canvas",
  },
  {
    path: "node_modules/@libsql/linux-x64-gnu",
    breaks: "the SQLite driver — the default database topology",
  },
]

/**
 * @param {object} lock parsed package-lock.json
 * @returns {{ missing: Array<{path: string, breaks: string}>, lockfileVersion: number }}
 */
export function auditLockfilePlatforms(lock) {
  const packages = lock.packages ?? {}
  const missing = REQUIRED_LINUX_PACKAGES.filter((p) => !(p.path in packages))
  return { missing, lockfileVersion: lock.lockfileVersion }
}

const target = resolve(
  process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(ROOT, "package-lock.json"),
)

if (!existsSync(target)) {
  console.error(
    `No lockfile at ${target}.\n` +
      "The Docker image installs exactly what the lockfile pins and cannot create one.",
  )
  process.exit(1)
}

const lock = JSON.parse(readFileSync(target, "utf8"))
const { missing, lockfileVersion } = auditLockfilePlatforms(lock)

if (lockfileVersion < 3) {
  console.error(
    `lockfileVersion is ${lockfileVersion}; this repository expects 3 (npm 9+).\n` +
      "A v1/v2 lockfile does not carry the `packages` map this check reads, and\n" +
      "`npm ci` behaves differently against it.",
  )
  process.exit(1)
}

if (missing.length) {
  console.error("\nThe lockfile was NOT generated on Linux.\n")
  for (const m of missing) {
    console.error(`  missing  ${m.path}`)
    console.error(`           breaks: ${m.breaks}`)
  }
  console.error(
    "\nnpm prunes platform-optional dependencies to the OS that generated the\n" +
      "lockfile, so a Windows or macOS `npm install` produces a lockfile the Linux\n" +
      "image cannot build from. Regenerate it in a Linux container, in a directory\n" +
      "with no node_modules:\n\n" +
      "  docker run --rm -v \"$PWD\":/w -w /w node:22-bookworm-slim \\\n" +
      "    sh -c 'rm -rf node_modules && npm install --package-lock-only --ignore-scripts'\n\n" +
      "See docs/docker.md and docs/ci.md.\n",
  )
  process.exit(1)
}

console.log(
  `Lockfile platform check passed (lockfileVersion ${lockfileVersion}, ` +
    `${REQUIRED_LINUX_PACKAGES.length} linux-x64-gnu binaries present).`,
)
