import { describe, expect, it } from "vitest"
import {
  advanceSchema,
  batchSchema,
  createMigrationSchema,
  cutoverSchema,
  entriesQuerySchema,
} from "@/Framework/Storage/Migration/migrationRequests"
import { buildDestinationConfig } from "@/Framework/Storage/Migration/migrationDestination"

/**
 * WHAT THE MIGRATION API REFUSES TO ACCEPT.
 *
 * The rule with teeth: a Local destination's path is DEPLOYMENT configuration.
 * A request that could name one would make an admin session a write primitive
 * anywhere the process can reach — `/etc`, a bind-mounted host directory,
 * another container's volume — and "migrate storage" would become a way to
 * scatter a site's media across a filesystem.
 *
 * Phase 4c DISCARDED such a field. That is safe and silent, and silent is the
 * problem: a client sending `{ driver: "local", root: "/etc" }` got a 201 and a
 * migration to somewhere else, with no way to tell that what it sent had been
 * ignored rather than honoured. Phase 5 refuses it.
 *
 * DEFENCE IN DEPTH, and both layers are tested: the schema refuses the field,
 * and `buildDestinationConfig` still ignores one if it ever arrives another way.
 */

const HOSTILE_PATHS = [
  "/etc",
  "/tmp",
  "/",
  "C:\\",
  "C:\\Windows\\System32",
  "\\\\server\\share",
  "../../outside",
  "/proc/self/environ",
  "/data/uploads/../../etc",
]

describe("a local destination takes no fields at all", () => {
  it("accepts the bare driver", () => {
    const parsed = createMigrationSchema.safeParse({
      mode: "copy",
      destination: { driver: "local" },
    })

    expect(parsed.success).toBe(true)
  })

  it.each(HOSTILE_PATHS)("REFUSES a submitted root of %s", (root) => {
    const parsed = createMigrationSchema.safeParse({
      mode: "copy",
      destination: { driver: "local", root },
    })

    expect(parsed.success).toBe(false)
  })

  it.each(["path", "directory", "localStoragePath", "LOCAL_STORAGE_PATH"])(
    "refuses a path under the alternative name %s",
    (field) => {
      const parsed = createMigrationSchema.safeParse({
        mode: "copy",
        destination: { driver: "local", [field]: "/etc" },
      })

      expect(parsed.success).toBe(false)
    },
  )

  it("explains that the path is deployment configuration", () => {
    // "unrecognized key: root" names the field and stops. An operator needs to
    // know it is not theirs to choose.
    const parsed = createMigrationSchema.safeParse({
      mode: "copy",
      destination: { driver: "local", root: "/etc" },
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0].code).toBe("unrecognized_keys")
    }
  })

  it("refuses S3 fields smuggled onto a local destination", () => {
    const parsed = createMigrationSchema.safeParse({
      mode: "copy",
      destination: { driver: "local", bucket: "somewhere-else" },
    })

    expect(parsed.success).toBe(false)
  })
})

describe("an s3 destination is strict too", () => {
  it("accepts its own fields", () => {
    const parsed = createMigrationSchema.safeParse({
      mode: "copy",
      destination: {
        driver: "s3",
        endpoint: "https://s3.example.com",
        region: "auto",
        bucket: "media",
        accessKeyId: "AKIA",
        secretAccessKey: "s",
      },
    })

    expect(parsed.success).toBe(true)
  })

  it("refuses a stray root", () => {
    const parsed = createMigrationSchema.safeParse({
      mode: "copy",
      destination: { driver: "s3", bucket: "media", root: "/etc" },
    })

    expect(parsed.success).toBe(false)
  })

  it("refuses an unknown driver outright", () => {
    // `garage` is the likeliest wrong value; it is infrastructure reached
    // through the s3 driver, not a driver.
    const parsed = createMigrationSchema.safeParse({
      mode: "copy",
      destination: { driver: "garage", bucket: "media" },
    })

    expect(parsed.success).toBe(false)
  })
})

describe("the second layer holds even if a path gets past the first", () => {
  it.each(HOSTILE_PATHS)("still resolves the deployment root, not %s", (root) => {
    const config = buildDestinationConfig({ driver: "local", root } as never, {
      LOCAL_STORAGE_PATH: "/data/uploads",
    } as unknown as NodeJS.ProcessEnv)

    expect(config).toEqual({ driver: "local", root: "/data/uploads" })
  })

  it("refuses entirely when the deployment configured no local root", () => {
    // Not "fall back to something": there is nowhere legitimate to migrate to.
    expect(() =>
      buildDestinationConfig({ driver: "local", root: "/etc" } as never, {
        LOCAL_STORAGE_PATH: "",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow()
  })
})

describe("every other request body is bounded", () => {
  it("caps the batch size a client may ask for", () => {
    expect(batchSchema.safeParse({ migrationId: uuid(), batchSize: 100_000 }).success).toBe(false)
  })

  it("caps the concurrency a client may ask for", () => {
    expect(batchSchema.safeParse({ migrationId: uuid(), concurrency: 512 }).success).toBe(false)
  })

  it("caps the page size of the entry report", () => {
    expect(entriesQuerySchema.safeParse({ migrationId: uuid(), limit: 100_000 }).success).toBe(false)
  })

  it("refuses a migration id that is not one", () => {
    expect(batchSchema.safeParse({ migrationId: "../../etc/passwd" }).success).toBe(false)
    expect(batchSchema.safeParse({ migrationId: "" }).success).toBe(false)
  })

  it("defaults the advance action rather than guessing per call site", () => {
    const parsed = advanceSchema.safeParse({ migrationId: uuid() })
    expect(parsed.success && parsed.data.action).toBe("transfer")
  })

  it("requires an explicit confirmation to cut over", () => {
    // The request that makes the destination authoritative and cannot be
    // undone. A replayed POST should not be one keystroke from doing so.
    expect(cutoverSchema.safeParse({ migrationId: uuid(), version: 1 }).success).toBe(false)
    expect(cutoverSchema.safeParse({ migrationId: uuid(), version: 1, confirm: false }).success).toBe(
      false,
    )
    expect(cutoverSchema.safeParse({ migrationId: uuid(), version: 1, confirm: true }).success).toBe(
      true,
    )
  })
})

function uuid() {
  return "11111111-2222-4333-8444-555555555555"
}
