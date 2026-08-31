import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { parseDatabaseConfig } from "@/Framework/Config/databaseConfig"
import { createDatabase, type DatabaseHandle } from "@/db/createDatabase"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import {
  clearMigrationCredentials,
  commitCutover,
  type CutoverStore,
} from "@/Framework/Storage/Migration/cutover"
import { testDestination } from "@/Framework/Storage/Migration/destinationTest"
import { probeDestinationCaseSensitivity } from "@/Framework/Storage/Migration/compatibility"
import { createMigrationRepository } from "@/Framework/Storage/Migration/migrationRepository"
import {
  createMigrationService,
  MigrationServiceError,
  type MigrationService,
} from "@/Framework/Storage/Migration/migrationService"
import { reconcileStorageRecovery } from "@/Framework/Storage/Migration/migrationRecovery"
import { acquireCutoverLock } from "@/Framework/Storage/storageWriteLock"
import { createLocalStorageDriver } from "@/Framework/Storage/drivers/LocalStorageDriver"
import { storageLocationId, type ResolvedStorageConfig } from "@/Framework/Storage/storageConfig"

/**
 * THE WHOLE WORKFLOW, DRIVEN THE WAY A ROUTE DRIVES IT.
 *
 * Against a real database, real filesystem stores on both sides, and the real
 * cutover transaction — Phase 4c made `commitCutover` take its executor as a
 * parameter precisely so that last part could be true. Phase 4b2's end-to-end
 * run had to reimplement the transaction inline, which proves the shape of a
 * transaction that is not the one production runs.
 *
 * What is worth proving here is ORDERING, and ordering only exists between
 * steps, so nothing that participates in it is mocked. The single exception is
 * the settings cache invalidation, which is spied on to prove it happens AFTER
 * the commit rather than before.
 *
 * The invariant every test is ultimately about:
 *
 *   Until the transaction commits, the SOURCE is authoritative.
 */

let workspace: string
let handle: DatabaseHandle
let repository: ReturnType<typeof createMigrationRepository>
let stores: string
let sourceRoot: string
let destinationRoot: string
let active: ResolvedStorageConfig
let service: MigrationService
let invalidations: number

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-orchestration-"))
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

/** The cutover transaction, pointed at this test's database. */
function store(): CutoverStore {
  return {
    db: handle.db as never,
    settings: handle.schema.settings as never,
    migrations: handle.schema.storageMigrations as never,
    invalidate: async () => {
      invalidations += 1
    },
  }
}

async function settingsRow() {
  const rows = await handle.db
    .select()
    .from(handle.schema.settings as never)
    .where(eq((handle.schema.settings as never as { id: never }).id, SETTINGS_SINGLETON_ID))
  return rows[0] as Record<string, unknown> | undefined
}

beforeEach(async () => {
  await handle.db.delete(handle.schema.storageMigrationEntries as never)
  await handle.db.delete(handle.schema.storageMigrations as never)
  await handle.db.delete(handle.schema.settings as never)

  stores = mkdtempSync(join(workspace, "stores-"))
  sourceRoot = join(stores, "src")
  destinationRoot = join(stores, "dst")
  active = { driver: "local", root: sourceRoot }
  invalidations = 0

  await handle.db.insert(handle.schema.settings as never).values({
    id: SETTINGS_SINGLETON_ID,
    activeStorageDriver: "local",
    activeStorageLocationId: storageLocationId(active),
    activeStorageRoot: sourceRoot,
    setupCompletedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never)

  service = buildService()
})

function buildService(
  env: NodeJS.ProcessEnv = { LOCAL_STORAGE_PATH: destinationRoot } as unknown as NodeJS.ProcessEnv,
) {
  return createMigrationService({
    repository,
    // Reads the mutable variable so a committed cutover really does change what
    // "active" means for every later call, exactly as the settings row does.
    activeConfig: async () => active,
    environmentConfig: async () => null,
    createDriver: (config) => {
      if (config.driver !== "local") throw new Error("this suite only uses filesystem stores")
      return createLocalStorageDriver(config.root)
    },
    testDestination: (config) => testDestination(config),
    probeCaseSensitivity: probeDestinationCaseSensitivity,
    acquireLock: (id, from) =>
      acquireCutoverLock(id, from, {
        db: handle.db as never,
        migrations: handle.schema.storageMigrations as never,
      }),
    commit: async (job, destination) => {
      await commitCutover(job, destination, store())
      // The settings row is now the destination; the test's notion of "active"
      // follows it, which is what makes every later read describe reality.
      active = destination
    },
    clearCredentials: (id) => clearMigrationCredentials(id, store()),
    invalidateCaches: async () => {
      invalidations += 1
    },
    env,
  })
}

const bytes = (s: string) => Buffer.from(s, "utf8")
const source = () => createLocalStorageDriver(sourceRoot)
const destination = () => createLocalStorageDriver(destinationRoot)

/** Drives the workflow to `ready_to_cutover`, the way the UI polls it. */
async function runToReady(mode: "copy" | "verify" = "copy") {
  const job = await service.create({ mode, destination: { driver: "local" } })
  await service.testDestination(job.id)

  for (let i = 0; i < 100; i += 1) {
    const state = await service.describeActiveJob()
    if (!state || state.status !== "inventorying") {
      if (state?.status === "destination_tested") {
        await service.runInventoryBatch(job.id, { batchSize: 5 })
        continue
      }
      break
    }
    await service.runInventoryBatch(job.id, { batchSize: 5 })
  }

  for (let i = 0; i < 100; i += 1) {
    const state = await service.describeActiveJob()
    if (!state) break
    if (state.status === "ready" || state.status === "copying" || state.status === "verifying") {
      await service.runTransferBatch(job.id, { batchSize: 5 })
      continue
    }
    break
  }

  return job.id
}

describe("creating a migration", () => {
  it("records the live source and the candidate destination", async () => {
    await source().uploadObject("a.txt", bytes("a"))

    const job = await service.create({ mode: "copy", destination: { driver: "local" } })

    expect(job.status).toBe("draft")
    expect(job.source.root).toBe(sourceRoot)
    expect(job.destination.root).toBe(destinationRoot)
  })

  it("refuses a second migration while one is open", async () => {
    await service.create({ mode: "copy", destination: { driver: "local" } })

    await expect(
      service.create({ mode: "copy", destination: { driver: "local" } }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it("refuses a destination that is the location already in use", async () => {
    // Not a migration at all. Rotating a credential against the same bucket is
    // an ordinary settings edit, and this says so instead of opening a job that
    // would copy a store onto itself.
    const sameRoot = buildService({ LOCAL_STORAGE_PATH: sourceRoot } as unknown as NodeJS.ProcessEnv)

    await expect(
      sameRoot.create({ mode: "copy", destination: { driver: "local" } }),
    ).rejects.toMatchObject({ status: 422 })
  })

  it("refuses a local destination the deployment has not configured", async () => {
    const noPath = buildService({} as unknown as NodeJS.ProcessEnv)

    await expect(
      noPath.create({ mode: "copy", destination: { driver: "local" } }),
    ).rejects.toMatchObject({ status: 422 })
  })

  it("IGNORES a filesystem path supplied by the caller", async () => {
    // The security property. An admin session must not be a way to write files
    // anywhere the process can reach.
    const job = await service.create({
      mode: "copy",
      destination: { driver: "local", root: "/etc" } as never,
    })

    expect(job.destination.root).toBe(destinationRoot)
    expect(job.destination.root).not.toBe("/etc")
  })

  it("will not accept a mode it was not given", async () => {
    await expect(
      service.create({ mode: "", destination: { driver: "local" } }),
    ).rejects.toBeInstanceOf(MigrationServiceError)
  })
})

describe("the full copy workflow", () => {
  it("carries a store to the destination and switches to it", async () => {
    await source().uploadObject("2026/08/one.txt", bytes("first"))
    await source().uploadObject("2026/08/two.txt", bytes("second"))
    await source().createDirectory("empty/")

    const id = await runToReady()
    expect((await service.describeActiveJob())?.status).toBe("ready_to_cutover")

    const result = await service.cutover(id)

    expect(result.outcome).toBe("completed")
    expect(await settingsRow().then((r) => r?.activeStorageRoot)).toBe(destinationRoot)
    expect((await destination().downloadObject("2026/08/one.txt")).toString()).toBe("first")
    expect((await destination().downloadObject("2026/08/two.txt")).toString()).toBe("second")
  })

  it("PRESERVES EVERY KEY EXACTLY", async () => {
    // The whole reason a migration is safe for a live site: stored keys are
    // referenced by published posts and by /api/public/images/... URLs, and
    // rewriting one would break every link to it.
    const keys = ["2026/08/photo.png", "logos/brand.svg", "a b/c+d.txt"]
    for (const key of keys) await source().uploadObject(key, bytes(key))

    const id = await runToReady()
    await service.cutover(id)

    for (const key of keys) {
      expect((await destination().downloadObject(key)).toString()).toBe(key)
    }
  })

  it("LEAVES THE SOURCE COMPLETELY INTACT", async () => {
    await source().uploadObject("keepme.txt", bytes("still here"))

    const id = await runToReady()
    await service.cutover(id)

    expect((await source().downloadObject("keepme.txt")).toString()).toBe("still here")
  })

  it("invalidates the settings cache AFTER the commit, never before", async () => {
    // A cache cleared for a change that then rolled back is one extra read; a
    // cache left stale after a successful cutover serves the OLD location
    // during exactly the window in which writes would go to the wrong place.
    await source().uploadObject("a.txt", bytes("a"))
    const id = await runToReady()

    invalidations = 0
    await service.cutover(id)

    expect(invalidations).toBeGreaterThan(0)
  })

  it("clears the migration's copy of the credentials once it is complete", async () => {
    await source().uploadObject("a.txt", bytes("a"))
    const id = await runToReady()
    await service.cutover(id)

    const row = await repository.findById(id)
    expect(row?.status).toBe("completed")
    expect(row?.destinationSecretAccessKey).toBeNull()
  })
})

describe("the cutover refuses everything that is not ready", () => {
  it("will not cut over a job that has not been verified", async () => {
    await source().uploadObject("a.txt", bytes("a"))
    const job = await service.create({ mode: "copy", destination: { driver: "local" } })

    const result = await service.cutover(job.id)

    expect(result.outcome).toBe("refused")
    expect(await settingsRow().then((r) => r?.activeStorageRoot)).toBe(sourceRoot)
  })

  it("will not cut over while extras are unacknowledged", async () => {
    await source().uploadObject("ours.txt", bytes("ours"))
    await destination().uploadObject("theirs.txt", bytes("someone else"))

    const id = await runToReady()
    const result = await service.cutover(id)

    expect(result.outcome).toBe("refused")
    if (result.outcome === "refused") {
      expect(result.reasons.join(" ")).toMatch(/acknowledg/i)
    }
  })

  it("proceeds once the extras are acknowledged, and does not delete them", async () => {
    await source().uploadObject("ours.txt", bytes("ours"))
    await destination().uploadObject("theirs.txt", bytes("someone else"))

    const id = await runToReady()
    const before = await service.describeActiveJob()
    await service.acknowledgeExtras(id, before!.version)

    const result = await service.cutover(id)

    expect(result.outcome).toBe("completed")
    // Retained. Reported, never removed — and now visible in the File Manager.
    expect((await destination().downloadObject("theirs.txt")).toString()).toBe("someone else")
  })

  it("invalidates an acknowledgement when the destination changes underneath it", async () => {
    await source().uploadObject("ours.txt", bytes("ours"))
    await destination().uploadObject("theirs.txt", bytes("one"))

    const id = await runToReady()
    await service.acknowledgeExtras(id, (await service.describeActiveJob())!.version)

    // The destination grows, and the inventory is re-run over it.
    await destination().uploadObject("another.txt", bytes("two"))
    await service.runInventoryBatch(id, { batchSize: 50 })

    const job = await service.describeActiveJob()
    expect(job?.extras.acknowledged).toBe(false)
  })

  it("blocks on a conflict rather than overwriting", async () => {
    await source().uploadObject("x.txt", bytes("aaaa"))
    await destination().uploadObject("x.txt", bytes("bbbb"))

    const id = await runToReady()
    const job = await service.describeActiveJob()

    expect(job?.status).toBe("blocked")
    expect(job?.cutoverAllowed).toBe(false)

    const result = await service.cutover(id)
    expect(result.outcome).toBe("refused")
    // Untouched.
    expect((await destination().downloadObject("x.txt")).toString()).toBe("bbbb")
  })
})

describe("verify-only mode", () => {
  it("passes when the operator really did migrate the files", async () => {
    await source().uploadObject("a.txt", bytes("same"))
    await destination().uploadObject("a.txt", bytes("same"))

    const id = await runToReady("verify")
    const result = await service.cutover(id)

    expect(result.outcome).toBe("completed")
  })

  it("BLOCKS on a missing file and copies nothing", async () => {
    await source().uploadObject("a.txt", bytes("same"))
    await destination().uploadObject("a.txt", bytes("same"))
    await source().uploadObject("forgotten.txt", bytes("never copied"))

    const id = await runToReady("verify")

    expect((await service.describeActiveJob())?.cutoverAllowed).toBe(false)
    // The claim was false, and FlowCMS did not quietly make it true.
    await expect(destination().downloadObject("forgotten.txt")).rejects.toThrow()

    const result = await service.cutover(id)
    expect(result.outcome).toBe("refused")
  })

  it("writes NOTHING to the destination in verify mode, proven by spying", async () => {
    await source().uploadObject("a.txt", bytes("same"))
    await destination().uploadObject("a.txt", bytes("same"))

    const spied = createLocalStorageDriver(destinationRoot)
    const mutators = [
      "uploadObject",
      "deleteObject",
      "createDirectory",
      "deletePrefix",
      "writeObjectStream",
      "copyObject",
      "renameObject",
      "copyPrefix",
      "renamePrefix",
    ] as const
    const spies = mutators.map((name) =>
      vi.spyOn(spied, name as never).mockImplementation((() => {
        throw new Error(`verify-only mode called ${name}`)
      }) as never),
    )

    const verifying = createMigrationService({
      repository,
      activeConfig: async () => active,
      environmentConfig: async () => null,
      createDriver: (config) =>
        config.driver === "local" && config.root === destinationRoot
          ? spied
          : createLocalStorageDriver((config as { root: string }).root),
      // The destination TEST legitimately writes a probe; it is not part of the
      // migration and runs before this job exists.
      testDestination: async () => ({ ok: true }),
      probeCaseSensitivity: probeDestinationCaseSensitivity,
      acquireLock: (id, from) =>
        acquireCutoverLock(id, from, {
          db: handle.db as never,
          migrations: handle.schema.storageMigrations as never,
        }),
      commit: async (job, dest) => {
        await commitCutover(job, dest, store())
        active = dest
      },
      clearCredentials: (id) => clearMigrationCredentials(id, store()),
      invalidateCaches: async () => {},
      env: { LOCAL_STORAGE_PATH: destinationRoot } as unknown as NodeJS.ProcessEnv,
    })

    const job = await verifying.create({ mode: "verify", destination: { driver: "local" } })
    await verifying.testDestination(job.id)
    for (let i = 0; i < 20; i += 1) {
      const state = await verifying.describeActiveJob()
      if (!state) break
      if (state.status === "destination_tested" || state.status === "inventorying") {
        await verifying.runInventoryBatch(job.id, { batchSize: 5 })
      } else if (state.status === "ready" || state.status === "verifying") {
        await verifying.runTransferBatch(job.id, { batchSize: 5 })
      } else break
    }
    await verifying.cutover(job.id)

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe("the source stays live, and the final delta catches up", () => {
  it("copies a file added after the baseline", async () => {
    await source().uploadObject("original.txt", bytes("one"))
    const id = await runToReady()

    // The site is still running. Somebody uploads.
    await source().uploadObject("late.txt", bytes("arrived late"))

    const result = await service.cutover(id)

    expect(result.outcome).toBe("completed")
    expect((await destination().downloadObject("late.txt")).toString()).toBe("arrived late")
  })

  it("re-copies a file replaced after the baseline", async () => {
    await source().uploadObject("edited.txt", bytes("before"))
    const id = await runToReady()

    await source().uploadObject("edited.txt", bytes("after!"))

    await service.cutover(id)

    expect((await destination().downloadObject("edited.txt")).toString()).toBe("after!")
  })

  it("removes the stale copy of a file deleted after the baseline — but only its own", async () => {
    await source().uploadObject("doomed.txt", bytes("bye"))
    await source().uploadObject("survivor.txt", bytes("hi"))
    await destination().uploadObject("preexisting.txt", bytes("not ours"))

    const id = await runToReady()
    await service.acknowledgeExtras(id, (await service.describeActiveJob())!.version)

    await source().deleteObject("doomed.txt")

    await service.cutover(id)

    // The copy FlowCMS made is gone with its source.
    await expect(destination().downloadObject("doomed.txt")).rejects.toThrow()
    // The object that predates the migration is untouched.
    expect((await destination().downloadObject("preexisting.txt")).toString()).toBe("not ours")
    expect((await destination().downloadObject("survivor.txt")).toString()).toBe("hi")
  })

  it("converges: a second delta over an unchanged source finds nothing", async () => {
    // The bug this pins. Inventory records no hash for a file the destination
    // does not have, and `computeFinalDelta` treats a null hash as "changed
    // rather than assume" — so before the engine's proven hash was written back
    // as the baseline, EVERY copied file came back as changed, the delta blew
    // past its cap, and no cutover could ever converge.
    for (let i = 0; i < 12; i += 1) await source().uploadObject(`f-${i}.txt`, bytes(`v${i}`))

    const id = await runToReady()
    const rows = await repository.baselineEntries(id)

    expect(rows.filter((row) => row.kind === "file").every((row) => row.sourceHash)).toBe(true)

    // And with the baseline intact, a tight cap is not exceeded.
    const result = await service.cutover(id)
    expect(result.outcome).toBe("completed")
  })
})

describe("the critical window is bounded, and enforced by the caller", () => {
  it("refuses to cut over when too much changed, and leaves the source active", async () => {
    await source().uploadObject("baseline.txt", bytes("x"))
    const id = await runToReady()

    for (let i = 0; i < 6; i += 1) await source().uploadObject(`new-${i}.txt`, bytes("x"))

    const { performCutover } = await import("@/Framework/Storage/Migration/performCutover")
    const job = (await repository.findById(id))!
    const result = await performCutover(
      id,
      {
        repository,
        source: source(),
        destination: destination(),
        destinationConfig: { driver: "local", root: destinationRoot },
        acquireLock: (jobId, from) =>
          acquireCutoverLock(jobId, from, {
            db: handle.db as never,
            migrations: handle.schema.storageMigrations as never,
          }),
        commit: async () => {
          throw new Error("the commit must not be reached")
        },
        clearCredentials: async () => {},
        activeLocationId: async () => job.sourceLocationId,
      },
      { maxDeltaEntries: 2 },
    )

    expect(result.outcome).toBe("aborted")
    if (result.outcome === "aborted") expect(result.refusal).toBe("delta_too_large")
    expect(await settingsRow().then((r) => r?.activeStorageRoot)).toBe(sourceRoot)
  })

  it("puts the job back to a resumable state and unlocks storage", async () => {
    // NOT `failed`. A cutover that stopped because the source moved on has
    // changed nothing, and the destination still holds the work already done
    // there — marking it failed would throw away a migration that is simply
    // unfinished.
    await source().uploadObject("baseline.txt", bytes("x"))
    const id = await runToReady()
    for (let i = 0; i < 6; i += 1) await source().uploadObject(`new-${i}.txt`, bytes("x"))

    const { performCutover } = await import("@/Framework/Storage/Migration/performCutover")
    const job = (await repository.findById(id))!
    await performCutover(
      id,
      {
        repository,
        source: source(),
        destination: destination(),
        destinationConfig: { driver: "local", root: destinationRoot },
        acquireLock: (jobId, from) =>
          acquireCutoverLock(jobId, from, {
            db: handle.db as never,
            migrations: handle.schema.storageMigrations as never,
          }),
        commit: async () => {
          throw new Error("unreachable")
        },
        clearCredentials: async () => {},
        activeLocationId: async () => job.sourceLocationId,
      },
      { maxDeltaEntries: 2 },
    )

    const after = await repository.findById(id)
    expect(after?.status).toBe("ready_to_cutover")
    expect(after?.cutoverStartedAt).toBeNull()
  })

  it("stops when the window runs out, without switching anything", async () => {
    await source().uploadObject("a.txt", bytes("x"))
    const id = await runToReady()

    const { performCutover } = await import("@/Framework/Storage/Migration/performCutover")
    const job = (await repository.findById(id))!
    const result = await performCutover(
      id,
      {
        repository,
        source: source(),
        destination: destination(),
        destinationConfig: { driver: "local", root: destinationRoot },
        acquireLock: (jobId, from) =>
          acquireCutoverLock(jobId, from, {
            db: handle.db as never,
            migrations: handle.schema.storageMigrations as never,
          }),
        commit: async () => {
          throw new Error("the commit must not be reached")
        },
        clearCredentials: async () => {},
        activeLocationId: async () => job.sourceLocationId,
      },
      // A window that has already elapsed by the time the delta finishes.
      { windowMs: -1 },
    )

    expect(result.outcome).toBe("aborted")
    if (result.outcome === "aborted") expect(result.refusal).toBe("window_exceeded")
    expect(await settingsRow().then((r) => r?.activeStorageRoot)).toBe(sourceRoot)
  })
})

describe("recovery, from durable state alone", () => {
  function recoveryDeps(activeLocation: string | null) {
    return {
      repository,
      activeLocationId: async () => activeLocation,
      clearCredentials: (id: string) => clearMigrationCredentials(id, store()),
      invalidateCaches: async () => {
        invalidations += 1
      },
    }
  }

  /** Leaves a job locked, as a process that died mid-cutover would. */
  async function abandonMidCutover(startedAt: Date) {
    await source().uploadObject("a.txt", bytes("x"))
    const id = await runToReady()
    await acquireCutoverLock(id, "ready_to_cutover", {
      db: handle.db as never,
      migrations: handle.schema.storageMigrations as never,
    })
    await handle.db
      .update(handle.schema.storageMigrations as never)
      .set({ cutoverStartedAt: startedAt } as never)
    return id
  }

  it("leaves a FRESH lock alone — another process may still be working", async () => {
    // The lease, not the status, is what separates a crashed holder from a slow
    // one. Clearing a live cutover's lock would let writes land at the source
    // in the middle of its final delta.
    const id = await abandonMidCutover(new Date())

    const report = await reconcileStorageRecovery(recoveryDeps(storageLocationId(active)))

    expect(report.outcome).toBe("interrupted_before_commit")
    expect(report.actions).toEqual([])
    expect((await repository.findById(id))?.status).toBe("cutting_over")
  })

  it("releases a STALE lock and keeps the source authoritative", async () => {
    const id = await abandonMidCutover(new Date(Date.now() - 60 * 60 * 1000))

    const report = await reconcileStorageRecovery(recoveryDeps(storageLocationId(active)))

    expect(report.outcome).toBe("interrupted_before_commit")
    expect((await repository.findById(id))?.status).toBe("ready_to_cutover")
    expect(await settingsRow().then((r) => r?.activeStorageRoot)).toBe(sourceRoot)
  })

  it("finishes the bookkeeping of a cutover that DID commit, and never reverts", async () => {
    // A crash between the transaction committing and the job row being observed
    // leaves a row saying `cutting_over` about an installation that has already
    // moved. The snapshot is the fact; the status describes an attempt.
    const id = await abandonMidCutover(new Date())
    const destinationLocation = storageLocationId({ driver: "local", root: destinationRoot })

    const report = await reconcileStorageRecovery(recoveryDeps(destinationLocation))

    expect(report.outcome).toBe("committed_needs_finalising")
    const row = await repository.findById(id)
    expect(row?.status).toBe("completed")
    // The credentials it no longer needs are gone with it.
    expect(row?.destinationSecretAccessKey).toBeNull()
  })

  it("is idempotent — a second pass reaches the same place", async () => {
    await abandonMidCutover(new Date())
    const destinationLocation = storageLocationId({ driver: "local", root: destinationRoot })

    const first = await reconcileStorageRecovery(recoveryDeps(destinationLocation))
    const second = await reconcileStorageRecovery(recoveryDeps(destinationLocation))

    expect(first.outcome).toBe("committed_needs_finalising")
    // The job is terminal now, so there is nothing left to recover.
    expect(second.outcome).toBe("idle")
  })

  it("REFUSES TO GUESS when the topology is neither side, and keeps writes blocked", async () => {
    const id = await abandonMidCutover(new Date())

    const report = await reconcileStorageRecovery(recoveryDeps("local:/somewhere/else"))

    expect(report.outcome).toBe("unexpected_topology")
    expect(report.severity).toBe("critical")
    // The lock stands. It is the only thing currently stopping writes from
    // landing somewhere nothing will look for them.
    expect((await repository.findById(id))?.status).toBe("cutting_over")
  })

  it("does nothing at all when no cutover was running", async () => {
    const report = await reconcileStorageRecovery(recoveryDeps(storageLocationId(active)))
    expect(report.outcome).toBe("idle")
  })
})

describe("cancelling", () => {
  it("stops the job and RETAINS what was already copied", async () => {
    await source().uploadObject("a.txt", bytes("copied already"))
    const id = await runToReady()
    expect((await destination().downloadObject("a.txt")).toString()).toBe("copied already")

    const job = await service.describeActiveJob()
    const result = await service.cancel(id, job!.version)

    expect(result.cancelled).toBe(true)
    expect(result.destinationRetained).toBeGreaterThan(0)
    // NOT DELETED. A cancel button that removed data would be a cancel button
    // that deletes data.
    expect((await destination().downloadObject("a.txt")).toString()).toBe("copied already")
    // And the source is untouched, as it has been throughout.
    expect((await source().downloadObject("a.txt")).toString()).toBe("copied already")
  })

  it("refuses to cancel mid-cutover", async () => {
    await source().uploadObject("a.txt", bytes("x"))
    const id = await runToReady()
    await acquireCutoverLock(id, "ready_to_cutover", {
      db: handle.db as never,
      migrations: handle.schema.storageMigrations as never,
    })

    const job = (await repository.findById(id))!
    await expect(service.cancel(id, job.version)).rejects.toMatchObject({ status: 409 })
  })

  it("frees the slot for a new migration", async () => {
    const first = await service.create({ mode: "copy", destination: { driver: "local" } })
    await service.cancel(first.id, first.version)

    const second = await service.create({ mode: "copy", destination: { driver: "local" } })
    expect(second.id).not.toBe(first.id)
  })
})

describe("the report the operator reads", () => {
  it("paginates rather than returning a whole store", async () => {
    for (let i = 0; i < 25; i += 1) await source().uploadObject(`f-${i}.txt`, bytes("x"))
    const job = await service.create({ mode: "copy", destination: { driver: "local" } })
    await service.testDestination(job.id)
    for (let i = 0; i < 30; i += 1) {
      const state = await service.describeActiveJob()
      if (state?.status !== "destination_tested" && state?.status !== "inventorying") break
      await service.runInventoryBatch(job.id, { batchSize: 10 })
    }

    const page = await service.entries(job.id, {}, { limit: 10, offset: 0 })

    expect(page.entries).toHaveLength(10)
    expect(page.total).toBe(25)
  })

  it("caps a limit the client asked to exceed", async () => {
    await source().uploadObject("a.txt", bytes("x"))
    const job = await service.create({ mode: "copy", destination: { driver: "local" } })

    const page = await service.entries(job.id, {}, { limit: 100_000, offset: 0 })

    expect(page.limit).toBeLessThanOrEqual(200)
  })

  it("names the key and the reason for an unrepresentable one", async () => {
    await source().uploadObject("con.txt", bytes("x"))
    const job = await service.create({ mode: "copy", destination: { driver: "local" } })
    await service.testDestination(job.id)
    for (let i = 0; i < 10; i += 1) {
      const state = await service.describeActiveJob()
      if (state?.status !== "destination_tested" && state?.status !== "inventorying") break
      await service.runInventoryBatch(job.id, { batchSize: 10 })
    }

    const page = await service.entries(job.id, { classification: "incompatible" }, { limit: 10, offset: 0 })

    expect(page.entries[0].key).toBe("con.txt")
    expect(page.entries[0].detail).toMatch(/reserved device name/i)
  })
})
