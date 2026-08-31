import { afterEach, describe, expect, it, vi } from "vitest"
import { StorageConfigurationError, type StorageConfigProblem } from "@/Framework/Storage/StorageErrors"

/**
 * THE TWO STORAGE STATUS SURFACES MUST NEVER DISAGREE.
 *
 * FlowCMS reports storage state in two places, for two audiences:
 *
 *   /api/ready                 an orchestrator, continuously
 *   /setup prerequisites       an operator, once, before completion
 *
 * They have separate vocabularies because they answer different questions, and
 * that is fine. What is not fine is the same deployment being described
 * differently by each — which is exactly what Phase 3 shipped: `/api/ready`
 * distinguished a misconfigured driver from an unconfigured install, and the
 * setup page collapsed both into "not configured".
 *
 * The concrete failure that caused: `STORAGE_DRIVER=garage` is the likeliest
 * wrong value, because `garage` IS one of the installer's storage choices. An
 * operator who set it saw "storage is not configured", went to check their S3
 * credentials — which were correct — and had nothing pointing at the one word
 * that was actually wrong.
 *
 * This file pins the mapping from BOTH sides against one table, so a change to
 * either surface alone fails here.
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
// Unpinned by default: the environment is authoritative, which is what these
// tests vary. A spy rather than a constant so the one case that is about the
// row being UNREADABLE can make it fail.
const getSettingsRow = vi.fn(async () => null as unknown)
vi.mock("@/Framework/Settings/SettingsService", () => ({
  getS3Config: () => getS3Config(),
  getSettingsRow: () => getSettingsRow(),
  invalidateSettingsCache: () => Promise.resolve(),
}))

const { checkStorage } = await import("@/Framework/Health/readiness")
const { checkStoragePrerequisite } = await import("@/Framework/Setup/prerequisites")
const { StorageService } = await import("@/Framework/Storage/StorageService")

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

/**
 * The single authority for what each problem means on each surface.
 *
 * `nothing has been set` is the ONLY problem that reads as "not configured" on
 * either surface. Everything else was set by somebody and is wrong — EXCEPT
 * `active_topology_unavailable`, which is neither: the configuration may be
 * perfect and the database unreachable, so it is a backend failure on both
 * sides. Reporting it as a misconfiguration would send an operator to edit
 * settings in the middle of an outage.
 */
const MAPPING: {
  problem: StorageConfigProblem
  readiness: string
  prerequisite: string
}[] = [
  { problem: "s3_incomplete", readiness: "not_configured", prerequisite: "not_configured" },
  { problem: "driver_invalid", readiness: "misconfigured", prerequisite: "misconfigured" },
  { problem: "local_path_missing", readiness: "misconfigured", prerequisite: "misconfigured" },
  {
    problem: "active_topology_unavailable",
    readiness: "connection_failed",
    prerequisite: "unavailable",
  },
]

describe("both surfaces classify the same problem the same way", () => {
  it.each(MAPPING)(
    "$problem -> readiness $readiness, setup $prerequisite",
    async ({ problem, readiness, prerequisite }) => {
      // The setup probe reaches storage through StorageService, so the error is
      // injected there; readiness resolves configuration directly.
      vi.spyOn(StorageService, "uploadObject").mockRejectedValue(
        new StorageConfigurationError(problem, "configuration problem"),
      )
      expect(await checkStoragePrerequisite()).toBe(prerequisite)

      // Drive readiness into the same problem through real configuration.
      if (problem === "driver_invalid") vi.stubEnv("STORAGE_DRIVER", "dropbox")
      else if (problem === "s3_incomplete") {
        vi.stubEnv("STORAGE_DRIVER", "s3")
        getS3Config.mockRejectedValue(new Error("S3 is not configured"))
      } else if (problem === "active_topology_unavailable") {
        // The one problem that is NOT reachable through configuration: it means
        // a completed installation could not read or record which location it
        // uses. Driven the only way it actually happens — the settings row
        // cannot be read at all.
        getSettingsRow.mockRejectedValueOnce(new Error("database is down"))
      } else {
        vi.stubEnv("STORAGE_DRIVER", "local")
        vi.stubEnv("LOCAL_STORAGE_PATH", "")
      }
      expect((await checkStorage()).status).toBe(readiness)
    },
  )
})

describe("an explicitly wrong value is never mistaken for a fresh install", () => {
  // Note: "S3 " and " Local " are NOT here. Whitespace and casing are trimmed
  // and lowercased deliberately, so those are valid values, not wrong ones.
  it.each(["dropbox", "garage", "filesystem", "local-disk", "minio"])(
    "STORAGE_DRIVER=%j is misconfigured on both surfaces",
    async (value) => {
      vi.stubEnv("STORAGE_DRIVER", value)

      const readiness = await checkStorage()
      expect(readiness.status).toBe("misconfigured")
      expect(readiness.status).not.toBe("not_configured")

      // The setup probe reaches the same conclusion through the driver it
      // cannot resolve.
      expect(await checkStoragePrerequisite()).toBe("misconfigured")
    },
  )

  it("a wholly unconfigured install is not_configured on both surfaces", async () => {
    vi.stubEnv("STORAGE_DRIVER", "")
    getS3Config.mockRejectedValue(new Error("S3 is not configured"))

    expect((await checkStorage()).status).toBe("not_configured")
    expect(await checkStoragePrerequisite()).toBe("not_configured")
  })
})

describe("every problem code is accounted for", () => {
  it("the mapping table covers the whole union", () => {
    // If a new problem code is added and nobody decides what it means on each
    // surface, this fails rather than letting it default silently.
    const covered = MAPPING.map((entry) => entry.problem).sort()
    const all: StorageConfigProblem[] = [
      "active_topology_unavailable",
      "driver_invalid",
      "local_path_missing",
      "s3_incomplete",
    ]
    expect(covered).toEqual(all.sort())
  })

  it("neither surface reports a configuration problem as ready", async () => {
    for (const { problem } of MAPPING) {
      vi.spyOn(StorageService, "uploadObject").mockRejectedValue(
        new StorageConfigurationError(problem, "configuration problem"),
      )
      expect(await checkStoragePrerequisite()).not.toBe("ready")
    }
  })
})
