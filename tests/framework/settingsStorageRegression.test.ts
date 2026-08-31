import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { rejectTopologyChange } from "@/Framework/Storage/storageTopologyGuard"

/**
 * THE SETTINGS SCREEN CANNOT MOVE AN INSTALLATION. STILL.
 *
 * The footgun this closes: Admin > Settings > Storage let an owner type a
 * different bucket name and press Save. The next request resolved a different
 * bucket, every image was gone, and the only way back was remembering the old
 * value. Nothing copied a file and nothing warned.
 *
 * Phase 4 added a legitimate way to relocate — a verified migration — which
 * makes this worth re-checking rather than assuming: the guard must still
 * refuse the SHORTCUT while the workflow exists beside it.
 */

describe("the topology guard refuses a relocation", () => {
  const current = { endpoint: "https://old.example.com", region: "r1", bucket: "old-bucket" }

  it.each(["bucket", "endpoint", "region"] as const)("refuses a changed %s", (field) => {
    const problem = rejectTopologyChange(current, { [field]: "something-else" })

    expect(problem).not.toBeNull()
    expect(problem).toMatch(new RegExp(field))
  })

  it("names every field that moved, not just the first", () => {
    const problem = rejectTopologyChange(current, {
      bucket: "new-bucket",
      endpoint: "https://new.example.com",
    })

    expect(problem).toMatch(/bucket/)
    expect(problem).toMatch(/endpoint/)
  })

  it("NEVER quotes the submitted value", () => {
    // An endpoint can carry `user:password@` in its userinfo, and a rejected
    // value echoed into a response is a credential in a log and a support
    // ticket.
    const problem = rejectTopologyChange(current, {
      endpoint: "https://user:hunter2@evil.example.com",
    })

    expect(problem).not.toContain("hunter2")
    expect(problem).not.toContain("evil.example.com")
  })

  it("points at the migration workflow rather than just saying no", () => {
    expect(rejectTopologyChange(current, { bucket: "x" })).toMatch(/migration/i)
  })
})

describe("what the guard deliberately allows", () => {
  const current = { endpoint: "https://old.example.com", region: "r1", bucket: "old-bucket" }

  it("allows a credential rotation, which moves no files", () => {
    // An operator whose key has leaked needs this immediately, and blocking it
    // would push them towards editing the database by hand.
    expect(rejectTopologyChange(current, {})).toBeNull()
  })

  it("allows the same values resubmitted, ignoring a trailing slash", () => {
    expect(
      rejectTopologyChange(current, {
        endpoint: "https://old.example.com/",
        region: "r1",
        bucket: "old-bucket",
      }),
    ).toBeNull()
  })

  it("allows a fresh install to set its bucket for the first time", () => {
    // There is nothing to relocate FROM.
    expect(rejectTopologyChange({ endpoint: undefined, region: undefined, bucket: "" }, {
      bucket: "first-bucket",
    })).toBeNull()
  })

  it("treats a blank submission as `leave it alone`, not as a move", () => {
    expect(rejectTopologyChange(current, { bucket: "", endpoint: "", region: "" })).toBeNull()
  })
})

describe("clearing an override cannot relocate an established installation", () => {
  it("resolves the SNAPSHOT, not the environment fallback", async () => {
    // The subtle path the guard alone does not cover: blanking `s3Bucket`
    // clears the override, and a naive resolver would then fall back to
    // `S3_BUCKET` — which may name a completely different bucket. What stops it
    // is that an established installation reads its LOCATION from the pinned
    // snapshot and only its CREDENTIALS from the settings-row-over-env path.
    vi.resetModules()
    vi.doMock("@/Framework/Settings/SettingsService", () => ({
      getSettingsRow: async () => ({
        setupCompletedAt: new Date(),
        activeStorageDriver: "s3",
        activeStorageBucket: "the-real-bucket",
        activeStorageEndpoint: "https://real.example.com",
        activeStorageRegion: "r1",
        // The override has been cleared.
        s3Bucket: null,
        s3AccessKeyId: "AKIA",
        s3SecretAccessKey: "secret",
      }),
      getS3Config: async () => ({
        bucket: "a-completely-different-bucket",
        endpoint: "https://elsewhere.example.com",
        region: "r9",
        accessKeyId: "AKIA",
        secretAccessKey: "secret",
      }),
      invalidateSettingsCache: async () => {},
    }))
    vi.stubEnv("S3_BUCKET", "a-completely-different-bucket")

    const { getActiveStorageConfig } = await import("@/Framework/Storage/activeStorage")
    const config = await getActiveStorageConfig()

    expect(config.driver === "s3" && config.bucket).toBe("the-real-bucket")

    vi.unstubAllEnvs()
    vi.doUnmock("@/Framework/Settings/SettingsService")
    vi.resetModules()
  })
})

describe("no other handler can write a storage location", () => {
  /**
   * Searched rather than assumed. The guard protects ONE route; a second
   * handler that wrote the same columns would be a second way to relocate an
   * installation, and it would not be obvious from reading the first.
   */
  const TOPOLOGY_COLUMNS = [
    "s3Bucket",
    "s3Endpoint",
    "s3Region",
    "activeStorageDriver",
    "activeStorageBucket",
    "activeStorageRoot",
    "activeStorageEndpoint",
    "activeStorageRegion",
    "activeStorageLocationId",
  ]

  it("only the guarded settings route and the cutover transaction write them", () => {
    const writers = new Set<string>()

    for (const file of sourceFiles("src")) {
      const code = stripComments(readFileSync(file, "utf8"))

      // A DATABASE WRITE, not a mention. Schema files declare these columns,
      // the settings form types them, and the storage screen reads them — none
      // of which can move an installation. What matters is a file that both
      // names a column and hands it to the database.
      const writesToDatabase = /\.(set|values)\(/.test(code) || /\bupdates\./.test(code)
      if (!writesToDatabase) continue
      if (file.includes("src/db/schema/")) continue

      if (TOPOLOGY_COLUMNS.some((column) => new RegExp(`\\b${column}\\b`).test(code))) {
        writers.add(file)
      }
    }

    expect([...writers].sort()).toEqual([
      // The pin and the cutover: the only two writes that establish or move a
      // location, both in the storage framework.
      "src/Framework/Storage/Migration/cutover.ts",
      "src/Framework/Storage/activeStorageStore.ts",
      // The ordinary settings save, which is guarded by rejectTopologyChange.
      "src/app/api/settings/global/route.ts",
    ])
  })

  it("keeps the guard on the settings route", () => {
    const route = readFileSync("src/app/api/settings/global/route.ts", "utf8")

    expect(route).toContain("rejectTopologyChange")
    // Refused with a conflict rather than silently dropped.
    expect(route).toMatch(/topologyProblem[\s\S]{0,200}status: 409/)
  })

  it("never accepts a local path from a request", () => {
    // LOCAL_STORAGE_PATH is deployment configuration. A path a request could
    // set would point uploads outside the persistent volume, and that failure
    // is silent until the next restart.
    const route = readFileSync("src/app/api/settings/global/route.ts", "utf8")
    const validations = readFileSync("src/Modules/Settings/Values/Validations.ts", "utf8")

    expect(stripComments(route)).not.toMatch(/updates\.(localStoragePath|activeStorageRoot)\s*=/)
    expect(validations).not.toMatch(/localStoragePath\s*:\s*z\./)
  })
})

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

function sourceFiles(root: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root)) {
    const full = join(root, entry).replace(/\\/g, "/")
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}
