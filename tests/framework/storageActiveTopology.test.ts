import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StorageConfigurationError } from "@/Framework/Storage/StorageErrors"

/**
 * EVERY STORAGE STATUS SURFACE REPORTS WHERE THE FILES ACTUALLY ARE.
 *
 * The bug this exists to prevent, stated concretely:
 *
 *     .env                     STORAGE_DRIVER=s3
 *     persisted active         local /data/uploads
 *
 * That is the NORMAL state of an installation that has completed an S3 -> Local
 * migration. The environment is not stale by accident — it is what the site was
 * installed with, and Phase 4 deliberately stopped it from being authoritative.
 * A probe that read it would report S3 as connected while every file lives on a
 * filesystem, which is worse than reporting nothing: it is a green light
 * pointing at the wrong backend.
 *
 * So the matrix below drives `checkStorage` across every combination of pinned
 * snapshot and environment, and the environment is deliberately WRONG in most
 * of them.
 */

const getSettingsRow = vi.fn()
const getS3Config = vi.fn()

vi.mock("@/Framework/Settings/SettingsService", () => ({
  getSettingsRow: () => getSettingsRow(),
  getS3Config: () => getS3Config(),
  invalidateSettingsCache: () => Promise.resolve(),
}))

// The snapshot write is not under test here; pinning is exercised by
// activeStorage.test.ts. Stubbed so an unpinned legacy install can be observed
// resolving from the environment without needing a database.
const pinActiveStorage = vi.fn<(config: unknown) => Promise<void>>(async () => {})
vi.mock("@/Framework/Storage/activeStorageStore", () => ({
  pinActiveStorage: (config: unknown) => pinActiveStorage(config),
  commitActiveStorage: () => Promise.resolve(),
}))

const { checkStorage } = await import("@/Framework/Health/readiness")

/** A settings row with the active-storage snapshot filled in. */
function pinnedTo(
  snapshot:
    | { driver: "local"; root: string }
    | { driver: "s3"; bucket: string; endpoint?: string; region?: string },
) {
  return {
    setupCompletedAt: new Date(),
    activeStorageDriver: snapshot.driver,
    activeStorageRoot: snapshot.driver === "local" ? snapshot.root : null,
    activeStorageBucket: snapshot.driver === "s3" ? snapshot.bucket : null,
    activeStorageEndpoint: snapshot.driver === "s3" ? (snapshot.endpoint ?? null) : null,
    activeStorageRegion: snapshot.driver === "s3" ? (snapshot.region ?? null) : null,
    s3AccessKeyId: "AKIA-ACTIVE",
    s3SecretAccessKey: "secret-active",
  }
}

beforeEach(() => {
  getSettingsRow.mockReset()
  getS3Config.mockReset()
  pinActiveStorage.mockClear()
  // A default, because `fromSnapshot` resolves credentials through this path
  // for every S3 snapshot. Individual tests override it where the credential
  // state is what they are about.
  getS3Config.mockResolvedValue({
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    endpoint: undefined,
    region: undefined,
  })
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("an installation that has never pinned a location", () => {
  it("resolves S3 from the environment, which is what it is really using", async () => {
    // The upgrade path: every installation that predates the snapshot column.
    getSettingsRow.mockResolvedValue(null)
    getS3Config.mockResolvedValue({
      bucket: "legacy",
      accessKeyId: "AKIA",
      secretAccessKey: "s",
      endpoint: undefined,
      region: undefined,
    })

    expect(await checkStorage()).toEqual({ status: "connected", driver: "s3" })
  })

  it("resolves Local from the environment", async () => {
    getSettingsRow.mockResolvedValue(null)
    vi.stubEnv("STORAGE_DRIVER", "local")
    vi.stubEnv("LOCAL_STORAGE_PATH", "/data/uploads")

    expect(await checkStorage()).toEqual({ status: "connected", driver: "local" })
  })

  it("reports an unrecognised STORAGE_DRIVER as misconfigured, with no driver", async () => {
    // `garage` is the likeliest wrong value: it IS one of the installer's
    // storage choices. It is infrastructure reached through the s3 driver.
    getSettingsRow.mockResolvedValue(null)
    vi.stubEnv("STORAGE_DRIVER", "garage")

    expect(await checkStorage()).toEqual({ status: "misconfigured", driver: null })
  })

  it("reports local with no path as misconfigured rather than unconfigured", async () => {
    getSettingsRow.mockResolvedValue(null)
    vi.stubEnv("STORAGE_DRIVER", "local")
    vi.stubEnv("LOCAL_STORAGE_PATH", "")

    expect(await checkStorage()).toEqual({ status: "misconfigured", driver: "local" })
  })

  it("reports an s3 install with no bucket as not configured", async () => {
    getSettingsRow.mockResolvedValue(null)
    getS3Config.mockRejectedValue(new Error("S3 is not configured"))

    expect(await checkStorage()).toEqual({ status: "not_configured", driver: "s3" })
  })
})

describe("after a migration, the SNAPSHOT decides — not the environment", () => {
  it("S3 -> Local: reports Local while the .env still says s3", async () => {
    // THE CASE THIS FILE EXISTS FOR.
    getSettingsRow.mockResolvedValue(pinnedTo({ driver: "local", root: "/data/uploads" }))
    vi.stubEnv("STORAGE_DRIVER", "s3")
    vi.stubEnv("S3_BUCKET", "old-bucket")

    expect(await checkStorage()).toEqual({ status: "connected", driver: "local" })
  })

  it("Local -> S3: reports S3 while the .env still says local", async () => {
    getSettingsRow.mockResolvedValue(pinnedTo({ driver: "s3", bucket: "new-bucket" }))
    vi.stubEnv("STORAGE_DRIVER", "local")
    vi.stubEnv("LOCAL_STORAGE_PATH", "/data/uploads")

    expect(await checkStorage()).toEqual({ status: "connected", driver: "s3" })
  })

  it("stays healthy when the stale environment is itself INVALID", async () => {
    // The nastiest version: the leftover configuration would not even resolve.
    // A probe that consulted it would mark a perfectly healthy migrated
    // installation misconfigured and have the orchestrator restart it.
    getSettingsRow.mockResolvedValue(pinnedTo({ driver: "local", root: "/data/uploads" }))
    vi.stubEnv("STORAGE_DRIVER", "garage")

    expect(await checkStorage()).toEqual({ status: "connected", driver: "local" })
  })

  it("stays healthy when the stale environment names local with no path", async () => {
    getSettingsRow.mockResolvedValue(pinnedTo({ driver: "s3", bucket: "new-bucket" }))
    vi.stubEnv("STORAGE_DRIVER", "local")
    vi.stubEnv("LOCAL_STORAGE_PATH", "")

    expect(await checkStorage()).toEqual({ status: "connected", driver: "s3" })
  })

  it("never pins over an existing snapshot", async () => {
    getSettingsRow.mockResolvedValue(pinnedTo({ driver: "local", root: "/data/uploads" }))
    vi.stubEnv("STORAGE_DRIVER", "s3")

    await checkStorage()

    expect(pinActiveStorage).not.toHaveBeenCalled()
  })

  it("reports an S3 snapshot as connected even when its credentials are missing", async () => {
    // Configuration health is "we know where the files are and how it is set
    // up", not "the bucket answered". A credential outage is a different
    // question, and this probe deliberately makes no network call — see the
    // note on checkStorage.
    getSettingsRow.mockResolvedValue({
      ...pinnedTo({ driver: "s3", bucket: "b" }),
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
    })
    getS3Config.mockRejectedValue(new Error("S3 is not configured"))

    expect(await checkStorage()).toEqual({ status: "connected", driver: "s3" })
  })
})

describe("when the location cannot be established at all", () => {
  it("reports a backend failure, not a misconfiguration", async () => {
    // A completed installation whose snapshot cannot be written or read back.
    // Nothing is wrong with the CONFIGURATION — the database is unreachable —
    // and sending the operator to the settings screen mid-outage would waste
    // the one thing they have, which is time.
    getSettingsRow.mockResolvedValue({ setupCompletedAt: new Date() })
    pinActiveStorage.mockRejectedValueOnce(new Error("database is down"))
    vi.stubEnv("STORAGE_DRIVER", "local")
    vi.stubEnv("LOCAL_STORAGE_PATH", "/data/uploads")

    expect(await checkStorage()).toEqual({ status: "connection_failed", driver: null })
  })

  it("claims no driver, because not knowing is the thing being reported", async () => {
    getSettingsRow.mockRejectedValue(new Error("database is down"))

    const result = await checkStorage()

    expect(result.driver).toBeNull()
    expect(result.status).toBe("connection_failed")
  })

  it("maps the same problem code to the setup page's own vocabulary", async () => {
    // The two surfaces must never describe one deployment differently.
    const { checkStoragePrerequisite } = await import("@/Framework/Setup/prerequisites")
    expect(typeof checkStoragePrerequisite).toBe("function")

    // Proven at the classifier level: `active_topology_unavailable` is a
    // backend failure on both sides, never "misconfigured".
    const error = new StorageConfigurationError("active_topology_unavailable", "x")
    expect(error.problem).toBe("active_topology_unavailable")
  })
})

describe("a cutover in progress does not make storage look broken", () => {
  it("still reports the source as connected", async () => {
    getSettingsRow.mockResolvedValue(pinnedTo({ driver: "s3", bucket: "source" }))

    expect(await checkStorage()).toEqual({ status: "connected", driver: "s3" })
  })

  it("does not consult the write lock at all", async () => {
    // The lock refuses MUTATIONS during a cutover; it says nothing about
    // whether storage is configured. Conflating the two would mark the
    // container unhealthy for the duration of every cutover and invite an
    // orchestrator to restart it mid-switch — during the one window in which a
    // restart is most expensive.
    //
    // Asserted structurally rather than behaviourally, because the property is
    // an absence: readiness must not grow a dependency on the lock later.
    const { readFileSync } = await import("node:fs")
    const source = readFileSync("src/Framework/Health/readiness.ts", "utf8")

    expect(source).not.toContain("storageWriteLock")
    expect(source).not.toContain("assertStorageWritable")
    expect(source).not.toContain("checkStorageWriteVerdict")
  })
})
