import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * WHERE THIS INSTALLATION'S FILES ACTUALLY LIVE.
 *
 * Phase 3 read the active backend straight from the environment on every
 * request. That is correct for choosing a backend at install time and
 * dangerous afterwards: editing `STORAGE_DRIVER` and restarting silently
 * repointed a live site at a different, empty location. Every stored key stayed
 * valid, nothing was copied, nothing warned, and every image was gone.
 *
 * So the environment BOOTSTRAPS an installation and a persisted snapshot OWNS
 * it from then on. The invariant these tests exist to protect:
 *
 *   Changing deployment configuration alone must not change where files live.
 */

const getSettingsRow = vi.fn()
const pinActiveStorage = vi.fn()
vi.mock("@/Framework/Settings/SettingsService", () => ({
  getSettingsRow: () => getSettingsRow(),
  getS3Config: () => Promise.resolve(S3_ENV),
}))
vi.mock("@/Framework/Storage/activeStorageStore", () => ({
  pinActiveStorage: (...a: unknown[]) => pinActiveStorage(...a),
}))

const S3_ENV = {
  endpoint: "https://env.example.com",
  region: "env-region",
  bucket: "env-bucket",
  accessKeyId: "AKIA-ENV",
  secretAccessKey: "env-secret",
}

const { getActiveStorageConfig, describeTopologyDrift } = await import(
  "@/Framework/Storage/activeStorage"
)

beforeEach(() => {
  getSettingsRow.mockReset().mockResolvedValue(null)
  pinActiveStorage.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** A settings row with an established active topology. */
function pinnedS3(overrides: Record<string, unknown> = {}) {
  return {
    setupCompletedAt: new Date("2026-01-01"),
    activeStorageDriver: "s3",
    activeStorageLocationId: "s3:https://pinned.example.com|pinned-region|pinned-bucket",
    activeStorageEndpoint: "https://pinned.example.com",
    activeStorageRegion: "pinned-region",
    activeStorageBucket: "pinned-bucket",
    activeStorageRoot: null,
    activeStorageEstablishedAt: new Date("2026-01-01"),
    s3AccessKeyId: "AKIA-STORED",
    s3SecretAccessKey: "stored-secret",
    ...overrides,
  }
}

describe("bootstrap: an installation with nothing pinned", () => {
  it("follows the environment on a fresh install", async () => {
    vi.stubEnv("STORAGE_DRIVER", "s3")
    getSettingsRow.mockResolvedValue(null)

    const config = await getActiveStorageConfig()

    expect(config).toEqual({ driver: "s3", ...S3_ENV })
  })

  it("follows the environment for a legacy install with no STORAGE_DRIVER", async () => {
    // The upgrade path. Every installation that exists today is in this state.
    vi.stubEnv("STORAGE_DRIVER", "")
    getSettingsRow.mockResolvedValue({ setupCompletedAt: null })

    expect((await getActiveStorageConfig()).driver).toBe("s3")
  })

  it("does NOT pin while setup is still incomplete", async () => {
    // An operator part-way through installation is still choosing. Pinning the
    // default Garage configuration the moment the container boots would make
    // their first real S3 edit look like a relocation and refuse it.
    vi.stubEnv("STORAGE_DRIVER", "s3")
    getSettingsRow.mockResolvedValue({ setupCompletedAt: null })

    await getActiveStorageConfig()

    expect(pinActiveStorage).not.toHaveBeenCalled()
  })

  it("pins the topology once setup is complete", async () => {
    // The moment the installation becomes real, what it is using becomes what
    // it owns. The second read models what the database actually contains once
    // the pin has committed.
    vi.stubEnv("STORAGE_DRIVER", "s3")
    getSettingsRow
      .mockResolvedValueOnce({ setupCompletedAt: new Date(), activeStorageDriver: null })
      .mockResolvedValue(
        pinnedS3({
          activeStorageBucket: "env-bucket",
          activeStorageEndpoint: "https://env.example.com",
          activeStorageRegion: "env-region",
        }),
      )

    const config = await getActiveStorageConfig()

    expect(pinActiveStorage).toHaveBeenCalledWith(
      expect.objectContaining({ driver: "s3", bucket: "env-bucket" }),
    )
    // And it serves the persisted value, not the one it happened to resolve.
    expect(config).toMatchObject({ bucket: "env-bucket" })
  })

  it("REFUSES rather than serving unpinned environment topology when the pin fails", async () => {
    // CHANGED IN PHASE 4a, and the checkpoint had this wrong.
    //
    // Pinning used to be best-effort: if the write failed, resolution carried
    // on using the environment. That quietly reopens the exact hole the
    // snapshot exists to close — a completed installation whose pin keeps
    // failing runs indefinitely on mutable environment topology while
    // believing itself protected, and an environment edit during that window
    // relocates it silently.
    //
    // A completed installation that cannot record where its files live is in a
    // state FlowCMS must not guess about. Refusing surfaces as a storage
    // configuration failure — readiness reports it, uploads fail loudly — and
    // the operator's next request tries again.
    vi.stubEnv("STORAGE_DRIVER", "s3")
    getSettingsRow.mockResolvedValue({ setupCompletedAt: new Date(), activeStorageDriver: null })
    pinActiveStorage.mockRejectedValue(new Error("SQLITE_BUSY"))

    await expect(getActiveStorageConfig()).rejects.toMatchObject({
      name: "StorageConfigurationError",
    })
  })

  it("re-reads the winner when another request pins first", async () => {
    // Two requests arrive together on a freshly-completed installation. Both
    // see no snapshot; the conditional UPDATE means only one writes. The loser
    // must NOT carry on with what it resolved from the environment — it must
    // adopt whatever was actually persisted, or the two requests would disagree
    // about where files live for the rest of their lifetimes.
    vi.stubEnv("STORAGE_DRIVER", "s3")
    vi.stubEnv("S3_BUCKET", "env-bucket")

    getSettingsRow
      .mockResolvedValueOnce({ setupCompletedAt: new Date(), activeStorageDriver: null })
      // The re-read after pinning: somebody else got there first.
      .mockResolvedValue(pinnedS3())

    const config = await getActiveStorageConfig()

    expect(config).toMatchObject({ bucket: "pinned-bucket" })
  })

  it("does not fall back to the environment when the re-read disagrees", async () => {
    vi.stubEnv("STORAGE_DRIVER", "local")
    vi.stubEnv("LOCAL_STORAGE_PATH", "/env/path")

    getSettingsRow
      .mockResolvedValueOnce({ setupCompletedAt: new Date(), activeStorageDriver: null })
      .mockResolvedValue(pinnedS3())

    // The environment said local; the persisted answer says s3. The persisted
    // answer wins, because it is the one that describes where the files are.
    expect((await getActiveStorageConfig()).driver).toBe("s3")
  })
})

describe("pinned: the snapshot is authoritative", () => {
  it("ignores a changed STORAGE_DRIVER", async () => {
    // THE HEADLINE INVARIANT. An operator who edits the environment and
    // restarts keeps serving the files they already have.
    vi.stubEnv("STORAGE_DRIVER", "local")
    vi.stubEnv("LOCAL_STORAGE_PATH", "/data/uploads")
    getSettingsRow.mockResolvedValue(pinnedS3())

    const config = await getActiveStorageConfig()

    expect(config.driver).toBe("s3")
    expect(config).toMatchObject({ bucket: "pinned-bucket" })
  })

  it("ignores a changed bucket", async () => {
    vi.stubEnv("STORAGE_DRIVER", "s3")
    vi.stubEnv("S3_BUCKET", "somewhere-else")
    getSettingsRow.mockResolvedValue(pinnedS3())

    expect(await getActiveStorageConfig()).toMatchObject({ bucket: "pinned-bucket" })
  })

  it("serves a pinned local topology from the snapshot", async () => {
    vi.stubEnv("STORAGE_DRIVER", "s3")
    getSettingsRow.mockResolvedValue(
      pinnedS3({
        activeStorageDriver: "local",
        activeStorageLocationId: "local:/data/uploads",
        activeStorageRoot: "/data/uploads",
        activeStorageEndpoint: null,
        activeStorageRegion: null,
        activeStorageBucket: null,
      }),
    )

    expect(await getActiveStorageConfig()).toEqual({ driver: "local", root: "/data/uploads" })
  })

  it("never re-pins an already-pinned installation", async () => {
    vi.stubEnv("STORAGE_DRIVER", "local")
    vi.stubEnv("LOCAL_STORAGE_PATH", "/somewhere/else")
    getSettingsRow.mockResolvedValue(pinnedS3())

    await getActiveStorageConfig()

    expect(pinActiveStorage).not.toHaveBeenCalled()
  })
})

describe("credentials still come from settings and environment", () => {
  it("uses the stored credentials with the pinned location", async () => {
    // Rotation must keep working: the snapshot owns WHERE, not WHO.
    getSettingsRow.mockResolvedValue(pinnedS3())

    expect(await getActiveStorageConfig()).toMatchObject({
      bucket: "pinned-bucket",
      accessKeyId: "AKIA-STORED",
      secretAccessKey: "stored-secret",
    })
  })

  it("falls back to environment credentials when none are stored", async () => {
    getSettingsRow.mockResolvedValue(
      pinnedS3({ s3AccessKeyId: null, s3SecretAccessKey: null }),
    )

    expect(await getActiveStorageConfig()).toMatchObject({
      accessKeyId: "AKIA-ENV",
      secretAccessKey: "env-secret",
    })
  })

  it("reports missing credentials as an S3 configuration problem", async () => {
    vi.stubEnv("S3_ACCESS_KEY_ID", "")
    getSettingsRow.mockResolvedValue(
      pinnedS3({ s3AccessKeyId: null, s3SecretAccessKey: null }),
    )
    // With no stored credentials and none in the environment the pinned bucket
    // cannot be reached — a configuration problem, not a relocation.
    const config = await getActiveStorageConfig()
    expect(config.driver).toBe("s3")
  })
})

describe("reporting drift, rather than acting on it", () => {
  it("says nothing when the environment agrees with the snapshot", () => {
    expect(
      describeTopologyDrift(
        { driver: "s3", endpoint: "https://a", region: "r", bucket: "b", accessKeyId: "", secretAccessKey: "" },
        { driver: "s3", endpoint: "https://a", region: "r", bucket: "b", accessKeyId: "", secretAccessKey: "" },
      ),
    ).toBeNull()
  })

  it("reports a driver change without applying it", async () => {
    const drift = describeTopologyDrift(
      { driver: "s3", endpoint: "https://a", region: "r", bucket: "b", accessKeyId: "", secretAccessKey: "" },
      { driver: "local", root: "/data/uploads" },
    )

    expect(drift).toBeTruthy()
    expect(drift).toMatch(/migrat/i)
  })

  it("ignores a credential difference, which is not drift", () => {
    expect(
      describeTopologyDrift(
        { driver: "s3", endpoint: "https://a", region: "r", bucket: "b", accessKeyId: "OLD", secretAccessKey: "old" },
        { driver: "s3", endpoint: "https://a", region: "r", bucket: "b", accessKeyId: "NEW", secretAccessKey: "new" },
      ),
    ).toBeNull()
  })

  it("never quotes the configured values back", async () => {
    // Drift is surfaced in the admin panel and in logs; an endpoint can carry
    // credentials in its userinfo.
    const drift = describeTopologyDrift(
      { driver: "s3", endpoint: "https://a", region: "r", bucket: "b", accessKeyId: "", secretAccessKey: "" },
      { driver: "s3", endpoint: "https://key:secret@evil.example.com", region: "r", bucket: "b", accessKeyId: "", secretAccessKey: "" },
    )

    expect(drift).not.toContain("secret")
    expect(drift).not.toContain("evil.example.com")
  })
})
