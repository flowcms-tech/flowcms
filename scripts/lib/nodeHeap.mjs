/**
 * THE V8 HEAP CEILING FOR `next build`, and how it reaches the process that
 * needs it.
 *
 * `next build` type-checks in a CHILD process: `runTypeScriptCli.js` spawns
 * `process.execPath tsc …` with a copy of `process.env` and no `execArgv`. So a
 * `--max-old-space-size` on the command line that starts the build raises the
 * ceiling of a parent that never runs out, while the child that does gets V8's
 * default — about 2 GB inside a memory-limited container. NODE_OPTIONS is the
 * one channel the child inherits.
 *
 * Pure functions, so the policy is testable without a build. The launcher
 * (scripts/build.mjs) does the reading and the spawning;
 * tests/scaffolder/buildLauncher.test.ts pins both.
 */

export const DEFAULT_BUILD_HEAP_MB = 4096

/**
 * The share of a container's memory limit the heap may claim.
 *
 * A heap ceiling is not the process's footprint: native memory, the compiler's
 * workers and the parent `next build` count against the same cgroup. A ceiling
 * AT the limit turns a readable "JavaScript heap out of memory" into a kernel
 * OOM-kill — exit 137, no stack, nothing to search for.
 */
export const CGROUP_HEADROOM = 0.75

/** cgroup v2 first, then v1: the container's own view of its limit. */
export const CGROUP_LIMIT_FILES = [
  "/sys/fs/cgroup/memory.max",
  "/sys/fs/cgroup/memory/memory.limit_in_bytes",
]

// v1 reports "no limit" as a page-aligned value just under 2^63, not as a word.
const UNLIMITED_BYTES = 2 ** 60

const isHeapFlag = (token) => /^--max[-_]old[-_]space[-_]size=\d+$/.test(token)
const tokens = (nodeOptions) => (nodeOptions ?? "").split(/\s+/).filter(Boolean)

/** The ceiling NODE_OPTIONS already sets, in MB — the last one, as V8 reads it. */
export function heapFlagIn(nodeOptions) {
  const flag = tokens(nodeOptions).findLast(isHeapFlag)
  return flag ? Number(flag.slice(flag.indexOf("=") + 1)) : null
}

/** NODE_OPTIONS minus any heap ceiling, every other option kept. */
export function withoutHeapFlag(nodeOptions) {
  return tokens(nodeOptions)
    .filter((token) => !isHeapFlag(token))
    .join(" ")
}

/**
 * The container's memory limit in MB, or null when there is none to respect.
 *
 * Read from the cgroup rather than `os.totalmem()`, which inside a container
 * reports the HOST's memory.
 */
export function cgroupLimitMb(readText) {
  for (const file of CGROUP_LIMIT_FILES) {
    let raw
    try {
      raw = String(readText(file)).trim()
    } catch {
      continue
    }
    if (raw === "max") return null
    const bytes = Number(raw)
    if (!Number.isFinite(bytes) || bytes <= 0) continue
    if (bytes >= UNLIMITED_BYTES) return null
    return Math.floor(bytes / 1048576)
  }
  return null
}

/**
 * Decide the ceiling and the NODE_OPTIONS that carries it.
 *
 *   1. FLOWCMS_BUILD_HEAP_MB — an explicit operator decision. Replaces any
 *      ceiling already in NODE_OPTIONS and is not capped.
 *   2. A ceiling already in NODE_OPTIONS — somebody chose it; keep it.
 *   3. Otherwise 4096 MB, lowered to CGROUP_HEADROOM of a smaller container.
 *
 * Every other NODE_OPTIONS entry survives: an operator's CA bundle or tracing
 * hook is not this script's to discard.
 */
export function resolveBuildHeap({ env, cgroupMb }) {
  const override = (env.FLOWCMS_BUILD_HEAP_MB ?? "").trim()
  const existing = (env.NODE_OPTIONS ?? "").trim()

  if (override !== "") {
    if (!/^[1-9]\d*$/.test(override)) {
      throw new Error(
        `FLOWCMS_BUILD_HEAP_MB must be a whole number of megabytes, such as 6144 (received "${override}").`,
      )
    }
    const heapMb = Number(override)
    return {
      heapMb,
      source: "override",
      nodeOptions: [withoutHeapFlag(existing), `--max-old-space-size=${heapMb}`].filter(Boolean).join(" "),
    }
  }

  const inherited = heapFlagIn(existing)
  if (inherited !== null) return { heapMb: inherited, source: "inherited", nodeOptions: existing }

  const capped = cgroupMb === null ? null : Math.floor(cgroupMb * CGROUP_HEADROOM)
  const heapMb = capped !== null && capped < DEFAULT_BUILD_HEAP_MB ? capped : DEFAULT_BUILD_HEAP_MB
  return {
    heapMb,
    source: heapMb === DEFAULT_BUILD_HEAP_MB ? "default" : "container-limit",
    nodeOptions: [existing, `--max-old-space-size=${heapMb}`].filter(Boolean).join(" "),
  }
}

/** One line for the build log, so an operator can see which rule applied. */
export function describeHeap({ heapMb, source }, cgroupMb) {
  switch (source) {
    case "override":
      return `${heapMb} MB (FLOWCMS_BUILD_HEAP_MB)`
    case "inherited":
      return `${heapMb} MB (already set in NODE_OPTIONS)`
    case "container-limit":
      return `${heapMb} MB (75% of the ${cgroupMb} MB container memory limit)`
    default:
      return `${heapMb} MB (default)`
  }
}
