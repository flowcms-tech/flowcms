import { readFileSync } from "node:fs"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { parseDatabaseConfig } from "@/Framework/Config/databaseConfig"
import { createDatabase, type DatabaseHandle } from "@/db/createDatabase"
import { destinationConfigOf } from "@/Framework/Storage/Migration/cutover"
import { describeLocation, redactEndpoint } from "@/Framework/Storage/Migration/migrationDestination"
import { toEntryDto, toJobDto } from "@/Framework/Storage/Migration/migrationDto"
import { createMigrationRepository } from "@/Framework/Storage/Migration/migrationRepository"
import { MigrationServiceError } from "@/Framework/Storage/Migration/migrationService"

/**
 * NOTHING THAT LEAVES THE PROCESS CARRIES A CREDENTIAL.
 *
 * A migration is the one part of FlowCMS that holds a SECOND set of storage
 * credentials — the destination's — in a database row, for as long as it takes
 * to reach a cutover. Every path out of that row is checked here with
 * recognisable fake values, because a leak of this kind is invisible in review:
 * a `{ ...row }` spread reads perfectly and ships the key.
 *
 * The endpoint matters as much as the key. `https://user:hunter2@s3.example.com`
 * is a valid S3 endpoint and a credential, and it flows into API responses,
 * React trees, log lines and support tickets unless something removes it.
 */

const SECRET = "SUPER-SECRET-DESTINATION-KEY-do-not-leak"
const ACCESS_KEY = "AKIA-RECOGNISABLE-ACCESS-KEY"
const USERINFO_SECRET = "hunter2"

let workspace: string
let handle: DatabaseHandle
let repository: ReturnType<typeof createMigrationRepository>

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-secrets-"))
  const url = `file:${join(workspace, "test.db")}`

  const { createClient } = await import("@libsql/client")
  const { drizzle } = await import("drizzle-orm/libsql")
  const { migrate } = await import("drizzle-orm/libsql/migrator")
  const client = createClient({ url })
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/db/migrations/sqlite" })
  } finally {
    client.close()
  }

  handle = createDatabase(parseDatabaseConfig({ DATABASE_DIALECT: "sqlite", DATABASE_URL: url }))
  repository = createMigrationRepository({
    db: handle.db as never,
    migrations: handle.schema.storageMigrations as never,
    entries: handle.schema.storageMigrationEntries as never,
  })
}, 60_000)

afterAll(async () => {
  await handle?.close().catch(() => {})
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // Windows holds the file handle briefly.
  }
})

beforeEach(async () => {
  await handle.db.delete(handle.schema.storageMigrationEntries as never)
  await handle.db.delete(handle.schema.storageMigrations as never)
})

/** A job carrying every secret this system can hold. */
async function jobWithSecrets() {
  return repository.create({
    mode: "copy",
    source: {
      driver: "s3",
      locationId: "s3:https://old.example.com||old-bucket",
      endpoint: `https://olduser:${USERINFO_SECRET}@old.example.com`,
      bucket: "old-bucket",
    },
    destination: {
      driver: "s3",
      locationId: "s3:https://new.example.com||new-bucket",
      endpoint: `https://newuser:${USERINFO_SECRET}@new.example.com`,
      bucket: "new-bucket",
    },
    destinationAccessKeyId: ACCESS_KEY,
    destinationSecretAccessKey: SECRET,
  })
}

function assertClean(value: unknown, what: string) {
  const serialised = JSON.stringify(value)
  expect(serialised, `${what} leaked the secret key`).not.toContain(SECRET)
  expect(serialised, `${what} leaked the access key id`).not.toContain(ACCESS_KEY)
  expect(serialised, `${what} leaked endpoint userinfo`).not.toContain(USERINFO_SECRET)
}

describe("the status DTO", () => {
  it("carries no credential from a job that holds every one of them", async () => {
    const job = await jobWithSecrets()

    const dto = toJobDto({
      job,
      byClassification: {},
      byState: {},
      progress: {
        total: 0,
        verified: 0,
        pending: 0,
        failed: 0,
        blocked: 0,
        sourceChanged: 0,
        sourceDeleted: 0,
        ambiguous: 0,
      },
      readiness: { ready: false, reasons: [] },
    })

    assertClean(dto, "the job DTO")
  })

  it("says only WHETHER a destination secret is configured", async () => {
    const job = await jobWithSecrets()

    const dto = toJobDto({
      job,
      byClassification: {},
      byState: {},
      progress: {
        total: 0,
        verified: 0,
        pending: 0,
        failed: 0,
        blocked: 0,
        sourceChanged: 0,
        sourceDeleted: 0,
        ambiguous: 0,
      },
      readiness: { ready: false, reasons: [] },
    })

    // The one fact an operator needs to decide whether to re-enter it. Not the
    // value, not its length, not a masked form.
    expect(dto.destinationHasCredentials).toBe(true)
    expect(JSON.stringify(dto)).not.toMatch(/\*{4,}/)
  })

  it("still identifies the location, so the summary is meaningful", async () => {
    const job = await jobWithSecrets()

    const dto = toJobDto({
      job,
      byClassification: {},
      byState: {},
      progress: {
        total: 0,
        verified: 0,
        pending: 0,
        failed: 0,
        blocked: 0,
        sourceChanged: 0,
        sourceDeleted: 0,
        ambiguous: 0,
      },
      readiness: { ready: false, reasons: [] },
    })

    // Redaction that removed the host as well would leave an operator unable to
    // tell which destination they configured.
    expect(dto.destination.bucket).toBe("new-bucket")
    expect(dto.destination.endpoint).toBe("https://***@new.example.com")
  })
})

describe("the entry report", () => {
  it("has no field a credential could sit in", () => {
    const dto = toEntryDto({
      key: "2026/08/photo.png",
      kind: "file",
      classification: "conflicting",
      state: "blocked",
      sourceSize: 10,
      destinationSize: 10,
      detail: "A different file with the same name is already at the destination.",
      attempts: 1,
    })

    expect(Object.keys(dto).sort()).toEqual([
      "attempts",
      "classification",
      "destinationSize",
      "detail",
      "key",
      "kind",
      "sourceSize",
      "state",
    ])
  })
})

describe("endpoint redaction", () => {
  it("removes userinfo wherever a location is described", () => {
    const described = describeLocation({
      driver: "s3",
      endpoint: `https://user:${USERINFO_SECRET}@s3.example.com`,
      region: "auto",
      bucket: "media",
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET,
    })

    assertClean(described, "describeLocation")
  })

  it("does not echo an endpoint it could not parse", () => {
    // Whatever made it unparseable says nothing about whether it holds a
    // secret, so "return it verbatim" is exactly the wrong fallback.
    expect(redactEndpoint(`??${USERINFO_SECRET}??`)).not.toContain(USERINFO_SECRET)
  })
})

describe("errors", () => {
  it("carries only the reasons it was constructed with", () => {
    const error = new MigrationServiceError(409, ["Something is not ready."])

    assertClean({ message: error.message, reasons: error.reasons }, "MigrationServiceError")
  })
})

describe("the credentials really are in the row, so the tests above mean something", () => {
  it("round-trips through destinationConfigOf for the cutover", async () => {
    // If the row did not hold the secret, every assertion above would pass
    // trivially. It does — this is the value the cutover transaction commits.
    const job = await jobWithSecrets()
    const config = destinationConfigOf(job)

    expect(config.driver === "s3" && config.secretAccessKey).toBe(SECRET)
  })
})

describe("nothing in the migration source logs a credential", () => {
  /**
   * A static check over the modules that HOLD the secret.
   *
   * Narrow on purpose: it does not try to prove the absence of logging in
   * general, only that the files with access to a destination credential do not
   * write the job row, the config object, or a raw storage error to the
   * console. A raw AWS exception is the realistic vector — it carries the
   * endpoint, the bucket and sometimes signed headers.
   */
  const FILES = [
    "src/Framework/Storage/Migration/migrationService.ts",
    "src/Framework/Storage/Migration/performCutover.ts",
    "src/Framework/Storage/Migration/cutover.ts",
    "src/Framework/Storage/Migration/migrationDto.ts",
    "src/Framework/Storage/Migration/migrationApi.ts",
    "src/Framework/Storage/Migration/destinationTest.ts",
    "src/app/api/settings/storage/migration/route.ts",
    "src/app/api/settings/storage/migration/cutover/route.ts",
    "src/app/api/settings/storage/migration/destination-test/route.ts",
  ]

  it.each(FILES)("%s logs no job row, config or raw error", (file) => {
    const source = readFileSync(file, "utf8")
    const logged = [...source.matchAll(/console\.(log|error|warn|info)\(([^\n]*)/g)].map(
      (match) => match[2],
    )

    for (const call of logged) {
      expect(call, `${file}: console call interpolates a value`).not.toMatch(/\$\{(job|row|config|destination|error)\b/)
      expect(call, `${file}: console call passes an error object`).not.toMatch(/,\s*error\s*\)/)
    }
  })

  it("never serialises a whole migration row into a response", () => {
    for (const file of FILES) {
      const source = readFileSync(file, "utf8")
      expect(source, `${file} spreads a database row into a response`).not.toMatch(
        /NextResponse\.json\(\s*\{\s*\.\.\.(job|row)\b/,
      )
    }
  })
})
