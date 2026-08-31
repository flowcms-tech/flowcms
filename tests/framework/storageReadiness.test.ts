import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Reporting storage state for BOTH drivers, without string-matching.
 *
 * The rule this file exists to enforce: a Local deployment with no S3
 * credentials is a correctly-configured installation, and must never be
 * reported as an S3 failure. Before Phase 3 that was impossible to get right —
 * `checkStorage` and `checkStoragePrerequisite` both classified a deployment by
 * running `error.message.includes("S3 is not configured")`, which is true of
 * every Local install by design.
 */

/**
 * Storage is declared writable here.
 *
 * These suites classify CONFIGURATION, and the setup probe reaches storage
 * through `StorageService` — which since Phase 4a consults the write gate, and
 * the gate FAILS CLOSED. With no database in this context the real gate answers
 * "unknown" and refuses, so every configuration verdict would come back
 * "unavailable" and prove nothing about configuration.
 *
 * The production consequence is real and intended: the storage prerequisite now
 * needs a reachable database. That is coherent, because the database is itself
 * a prerequisite checked alongside it — an installation whose database is down
 * has a bigger problem than its bucket.
 */
vi.mock("@/Framework/Storage/storageWriteLock", () => ({
  assertStorageWritable: async () => {},
}))

const getS3Config = vi.fn()
vi.mock("@/Framework/Settings/SettingsService", () => ({
  getS3Config: () => getS3Config(),
  // Unpinned: the environment is authoritative, which is what these tests vary.
  getSettingsRow: () => Promise.resolve(null),
}))

const { checkStorage } = await import("@/Framework/Health/readiness")
const { checkStoragePrerequisite } = await import("@/Framework/Setup/prerequisites")

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-ready-"))
  getS3Config.mockReset().mockResolvedValue({
    endpoint: "https://s3.example.com",
    region: "us-east-1",
    bucket: "flowcms",
    accessKeyId: "AKIA",
    secretAccessKey: "secret",
  })
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function useLocal(root: string) {
  vi.stubEnv("STORAGE_DRIVER", "local")
  vi.stubEnv("LOCAL_STORAGE_PATH", root)
}

describe("checkStorage — which driver is being reported", () => {
  it("reports a legacy deployment (no STORAGE_DRIVER) as s3", async () => {
    vi.stubEnv("STORAGE_DRIVER", "")

    expect(await checkStorage()).toEqual({ status: "connected", driver: "s3" })
  })

  it("reports incomplete s3 configuration as not_configured", async () => {
    vi.stubEnv("STORAGE_DRIVER", "s3")
    getS3Config.mockRejectedValue(new Error("S3 is not configured"))

    expect(await checkStorage()).toEqual({ status: "not_configured", driver: "s3" })
  })

  it("reports a configured local deployment as connected", async () => {
    useLocal(join(workspace, "uploads"))

    // NO S3 CREDENTIALS AT ALL. This is the case that was impossible to report
    // correctly before typed errors.
    getS3Config.mockRejectedValue(new Error("S3 is not configured"))

    expect(await checkStorage()).toEqual({ status: "connected", driver: "local" })
  })

  it("reports a local deployment with no path as misconfigured", async () => {
    vi.stubEnv("STORAGE_DRIVER", "local")
    vi.stubEnv("LOCAL_STORAGE_PATH", "")

    // Distinct from `not_configured`: the operator DID choose a driver, they
    // just did not finish. Different sentence in the runbook.
    expect(await checkStorage()).toEqual({ status: "misconfigured", driver: "local" })
  })

  it("reports an unknown STORAGE_DRIVER as misconfigured with no driver", async () => {
    vi.stubEnv("STORAGE_DRIVER", "garage")

    expect(await checkStorage()).toEqual({ status: "misconfigured", driver: null })
  })

  it("never performs a network round trip", async () => {
    // This probe runs every fifteen seconds for the life of the container.
    // Turning it into steady authenticated traffic against an operator's object
    // store — or letting it stall on that store's timeout — costs more than the
    // freshness is worth.
    vi.stubEnv("STORAGE_DRIVER", "s3")

    const result = await checkStorage()

    expect(result.status).toBe("connected")
    expect(getS3Config).toHaveBeenCalledTimes(1)
  })
})

describe("checkStoragePrerequisite — a real round trip, on the active driver", () => {
  it("passes for a Local deployment with no S3 configuration whatsoever", async () => {
    useLocal(join(workspace, "uploads"))
    getS3Config.mockRejectedValue(new Error("S3 is not configured"))

    // THE HEADLINE PHASE 3 REQUIREMENT: a valid Local installation must be able
    // to complete first-run setup without S3 credentials.
    expect(await checkStoragePrerequisite()).toBe("ready")
  })

  it("creates the local root when it does not exist yet", async () => {
    const root = join(workspace, "deep", "not", "created")
    useLocal(root)

    expect(await checkStoragePrerequisite()).toBe("ready")
  })

  it("reports a missing LOCAL_STORAGE_PATH as misconfigured", async () => {
    vi.stubEnv("STORAGE_DRIVER", "local")
    vi.stubEnv("LOCAL_STORAGE_PATH", "")

    // CHANGED IN PHASE 4. This used to collapse to `not_configured`, which was
    // inconsistent with `/api/ready` — the same deployment was described two
    // different ways depending on which surface you asked.
    expect(await checkStoragePrerequisite()).toBe("misconfigured")
  })

  it("reports an invalid STORAGE_DRIVER as misconfigured", async () => {
    vi.stubEnv("STORAGE_DRIVER", "nonsense")

    expect(await checkStoragePrerequisite()).toBe("misconfigured")
  })

  it("still reports a fresh, wholly unconfigured install as not_configured", async () => {
    // The distinction that matters: nothing set, versus something set wrongly.
    vi.stubEnv("STORAGE_DRIVER", "")
    getS3Config.mockRejectedValue(new Error("S3 is not configured"))

    expect(await checkStoragePrerequisite()).toBe("not_configured")
  })

  it("describes garage — the likeliest wrong value — as misconfigured, not missing", async () => {
    // `garage` IS one of the installer's storage choices, so it is the value an
    // operator is most likely to put here. Told "not configured", they would go
    // and check S3 credentials that are perfectly fine.
    vi.stubEnv("STORAGE_DRIVER", "garage")

    expect(await checkStoragePrerequisite()).toBe("misconfigured")
  })

  it("reports an unusable local root as unavailable, not not_configured", async () => {
    // A path that cannot be a directory because a FILE already occupies it.
    // The operator configured something; it does not work. That is a different
    // sentence from "you have not configured storage".
    const occupied = join(workspace, "occupied")
    writeFileSync(occupied, "I am a file, not a directory")
    useLocal(join(occupied, "uploads"))

    expect(await checkStoragePrerequisite()).toBe("unavailable")
  })

  it("leaves no probe artefact behind on a local root — not even a folder", async () => {
    const root = join(workspace, "uploads")
    mkdirSync(root, { recursive: true })
    useLocal(root)

    await checkStoragePrerequisite()

    // The probe writes, reads back, compares and deletes. A first-run check
    // that litters an operator's storage every time they reload the setup page
    // is a defect, not a diagnostic.
    //
    // The FOLDER is the part that needed fixing. The probe key used to be
    // `.flowcms-setup-check/<uuid>.txt`; on S3 that is one object and deleting
    // it leaves nothing, but on a filesystem it is a directory containing a
    // file, and unlinking the file leaves the directory. Every Local install
    // grew a permanent phantom folder in its File Manager.
    const { readdirSync } = await import("node:fs")
    expect(readdirSync(root)).toEqual([])
  })

  it("uses a probe key that cannot create a directory on any backend", async () => {
    // The structural guarantee behind the test above: no slash, so there is no
    // parent to leave behind. Asserted on the constant rather than on a
    // filesystem side effect, so it also holds for S3.
    const { SETUP_PROBE_PREFIX } = await import("@/Framework/Setup/prerequisites")

    expect(SETUP_PROBE_PREFIX).not.toContain("/")
    expect(SETUP_PROBE_PREFIX.startsWith(".")).toBe(true)
  })

  it("still reports incomplete S3 configuration as not_configured", async () => {
    vi.stubEnv("STORAGE_DRIVER", "s3")
    getS3Config.mockRejectedValue(new Error("S3 is not configured"))

    expect(await checkStoragePrerequisite()).toBe("not_configured")
  })
})
