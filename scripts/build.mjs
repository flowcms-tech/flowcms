#!/usr/bin/env node
/**
 * THE PRODUCTION BUILD: `npm run build`, every other manager's `run build`, and
 * the Dockerfile's builder stage all run this file.
 *
 * WHY A LAUNCHER, AND NOT `node --max-old-space-size=4096 …/next build`
 *
 * That command was the build script through 0.2.3, and its flag never reached
 * the process that ran out of memory: Next type-checks in a child process that
 * inherits the environment but not the parent's flags (lib/nodeHeap.mjs). The
 * Dockerfile compensated with `ENV NODE_OPTIONS`, which fixed image builds and
 * nothing else — Railpack, Nixpacks and buildpacks run this script and never
 * read a Dockerfile. Setting NODE_OPTIONS here fixes every build path at once
 * and leaves one definition instead of two that drift.
 *
 * An inline `NODE_OPTIONS=… next build` would be shorter, and is POSIX-only:
 * `npm run` on Windows goes through cmd.exe, which cannot parse it.
 *
 * Next is invoked by path through node, not through a package manager, for the
 * reason tests/scaffolder/rootScripts.test.ts enforces: the Docker builder
 * stage may not have the manager that installed node_modules.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { cgroupLimitMb, describeHeap, resolveBuildHeap } from "./lib/nodeHeap.mjs"
import { runChild } from "./lib/runChild.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const NEXT_BIN = join(ROOT, "node_modules", "next", "dist", "bin", "next")

async function main() {
  const cgroupMb = cgroupLimitMb((file) => readFileSync(file, "utf8"))
  const heap = resolveBuildHeap({ env: process.env, cgroupMb })
  console.log(`FlowCMS build: V8 heap ceiling ${describeHeap(heap, cgroupMb)}`)

  return runChild(process.execPath, [NEXT_BIN, "build", ...process.argv.slice(2)], {
    env: { ...process.env, NODE_OPTIONS: heap.nodeOptions },
  })
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`FlowCMS build: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  },
)
