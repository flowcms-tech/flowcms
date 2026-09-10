import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import {
  CGROUP_HEADROOM,
  DEFAULT_BUILD_HEAP_MB,
  cgroupLimitMb,
  heapFlagIn,
  resolveBuildHeap,
} from "../../scripts/lib/nodeHeap.mjs"
import { exitCodeFor, runChild } from "../../scripts/lib/runChild.mjs"

/**
 * `next build` type-checks in a CHILD process that inherits the environment
 * and not the parent's command-line flags, so the build's heap ceiling has to
 * travel in NODE_OPTIONS. `scripts/build.mjs` puts it there, for every build
 * path — the Dockerfile's builder stage and every buildpack alike.
 */

const reader = (files: Record<string, string>) => (path: string) => {
  if (path in files) return files[path]
  throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })
}
const V2 = "/sys/fs/cgroup/memory.max"
const V1 = "/sys/fs/cgroup/memory/memory.limit_in_bytes"

describe("heapFlagIn", () => {
  it("finds the flag among other options", () => {
    expect(heapFlagIn("--use-openssl-ca --max-old-space-size=3000 --enable-source-maps")).toBe(3000)
  })
  it("accepts V8's underscore spelling", () => {
    expect(heapFlagIn("--max_old_space_size=2500")).toBe(2500)
  })
  it("uses the last occurrence, as V8 does", () => {
    expect(heapFlagIn("--max-old-space-size=1000 --max-old-space-size=2000")).toBe(2000)
  })
  it("is null when absent", () => {
    expect(heapFlagIn("--use-openssl-ca")).toBeNull()
    expect(heapFlagIn(undefined)).toBeNull()
  })
})

describe("cgroupLimitMb", () => {
  it("reads a cgroup v2 limit", () => {
    expect(cgroupLimitMb(reader({ [V2]: "8589934592\n" }))).toBe(8192)
  })
  it("treats v2 'max' as no limit", () => {
    expect(cgroupLimitMb(reader({ [V2]: "max\n" }))).toBeNull()
  })
  it("falls back to cgroup v1", () => {
    expect(cgroupLimitMb(reader({ [V1]: "4294967296" }))).toBe(4096)
  })
  it("treats v1's near-2^63 sentinel as no limit", () => {
    expect(cgroupLimitMb(reader({ [V1]: "9223372036854771712" }))).toBeNull()
  })
  it("is null outside a cgroup (Windows, macOS)", () => {
    expect(cgroupLimitMb(reader({}))).toBeNull()
  })
})

describe("resolveBuildHeap", () => {
  it("defaults to 4096 MB", () => {
    expect(resolveBuildHeap({ env: {}, cgroupMb: null })).toEqual({
      heapMb: DEFAULT_BUILD_HEAP_MB,
      source: "default",
      nodeOptions: "--max-old-space-size=4096",
    })
  })

  it("appends to an operator's NODE_OPTIONS instead of replacing it", () => {
    const heap = resolveBuildHeap({ env: { NODE_OPTIONS: "--use-openssl-ca" }, cgroupMb: null })
    expect(heap.nodeOptions).toBe("--use-openssl-ca --max-old-space-size=4096")
  })

  it("honours a ceiling already in NODE_OPTIONS, even above the container cap", () => {
    const heap = resolveBuildHeap({ env: { NODE_OPTIONS: "--max-old-space-size=6144" }, cgroupMb: 2048 })
    expect(heap).toEqual({ heapMb: 6144, source: "inherited", nodeOptions: "--max-old-space-size=6144" })
  })

  it("caps the default below a small container's memory limit", () => {
    const heap = resolveBuildHeap({ env: {}, cgroupMb: 3072 })
    expect(heap.heapMb).toBe(Math.floor(3072 * CGROUP_HEADROOM))
    expect(heap.source).toBe("container-limit")
  })

  it("never raises the default because a container is large", () => {
    expect(resolveBuildHeap({ env: {}, cgroupMb: 32768 }).heapMb).toBe(DEFAULT_BUILD_HEAP_MB)
  })

  it("lets FLOWCMS_BUILD_HEAP_MB replace an existing flag, uncapped", () => {
    const heap = resolveBuildHeap({
      env: { FLOWCMS_BUILD_HEAP_MB: "6144", NODE_OPTIONS: "--use-openssl-ca --max-old-space-size=2048" },
      cgroupMb: 2048,
    })
    expect(heap).toEqual({
      heapMb: 6144,
      source: "override",
      nodeOptions: "--use-openssl-ca --max-old-space-size=6144",
    })
  })

  it("ignores a blank override", () => {
    expect(resolveBuildHeap({ env: { FLOWCMS_BUILD_HEAP_MB: "  " }, cgroupMb: null }).source).toBe("default")
  })

  it.each(["4g", "0", "-1", "1.5", "abc"])("refuses the override %j", (value) => {
    expect(() => resolveBuildHeap({ env: { FLOWCMS_BUILD_HEAP_MB: value }, cgroupMb: null })).toThrow(
      /FLOWCMS_BUILD_HEAP_MB must be a whole number of megabytes/,
    )
  })
})

describe("the ceiling reaches a child spawned the way Next spawns tsc", () => {
  // Next: spawn(process.execPath, [tsc, …], { env: { ...process.env } }) — no
  // execArgv. The probe reproduces exactly that one level down.
  const PROBE = [
    'const { spawnSync } = require("node:child_process")',
    'const r = spawnSync(process.execPath, ["-e", "console.log(require(\'node:v8\').getHeapStatistics().heap_size_limit)"], { env: { ...process.env }, encoding: "utf8" })',
    "process.stdout.write(r.stdout)",
  ].join("\n")

  it("a 1234 MB ceiling is what the grandchild gets", () => {
    const { nodeOptions } = resolveBuildHeap({ env: { FLOWCMS_BUILD_HEAP_MB: "1234" }, cgroupMb: null })
    const result = spawnSync(process.execPath, ["-e", PROBE], {
      env: { ...process.env, NODE_OPTIONS: nodeOptions },
      encoding: "utf8",
    })
    const grandchildMb = Number(result.stdout.trim()) / 1048576
    // heap_size_limit is old space plus the young generation, so 1234 reads ≈1282.
    expect(grandchildMb).toBeGreaterThanOrEqual(1234)
    expect(grandchildMb).toBeLessThan(1234 + 128)
  })
})

describe("exitCodeFor", () => {
  it("passes an exit code through", () => {
    expect(exitCodeFor(0, null)).toBe(0)
    expect(exitCodeFor(2, null)).toBe(2)
  })
  it("reports a signal death as 128 + signum, as a shell does", () => {
    expect(exitCodeFor(null, "SIGTERM")).toBe(143)
    expect(exitCodeFor(null, "SIGKILL")).toBe(137)
  })
  it("is 1 when the child reported neither", () => {
    expect(exitCodeFor(null, null)).toBe(1)
  })
})

describe("runChild", () => {
  it("resolves to the child's exit code", async () => {
    expect(await runChild(process.execPath, ["-e", "process.exit(3)"])).toBe(3)
  })
  it("gives the child the environment it is handed", async () => {
    const code = await runChild(process.execPath, ["-e", "process.exit(process.env.FLOWCMS_PROBE === 'yes' ? 0 : 1)"], {
      env: { ...process.env, FLOWCMS_PROBE: "yes" },
    })
    expect(code).toBe(0)
  })
  it("stops listening for signals once the child has exited", async () => {
    const before = process.listenerCount("SIGTERM")
    await runChild(process.execPath, ["-e", ""])
    expect(process.listenerCount("SIGTERM")).toBe(before)
  })
})
