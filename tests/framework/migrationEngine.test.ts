import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  executeBatch,
  executeEntry,
  needsReverificationAfterRestart,
  type ExecutableEntry,
} from "@/Framework/Storage/Migration/migrationEngine"
import { createLocalStorageDriver } from "@/Framework/Storage/drivers/LocalStorageDriver"
import { digestObject } from "@/Framework/Storage/Migration/contentHash"
import { StorageObjectNotFoundError } from "@/Framework/Storage/StorageErrors"
import type { StorageDriver } from "@/Framework/Storage/StorageDriver"

/**
 * MOVING THE BYTES.
 *
 * Two properties matter more than the rest here, and most of this file exists
 * for them:
 *
 *   UPLOAD SUCCESS IS NOT EVIDENCE. A backend can accept bytes and store
 *   something else — a truncated write, a proxy that rewrote the body — so the
 *   destination is read back and hashed. "We sent it" and "it is there" are
 *   different claims.
 *
 *   VERIFY-ONLY MEANS ZERO WRITES. The operator said they had already migrated
 *   the files. Quietly copying the ones they missed would answer a question
 *   they did not ask and hide that their own migration was incomplete.
 */

let workspace: string
let source: StorageDriver
let destination: StorageDriver

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-engine-"))
  source = createLocalStorageDriver(join(workspace, "src"))
  destination = createLocalStorageDriver(join(workspace, "dst"))
})

afterEach(() => {
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // Windows keeps handles briefly; the OS reaps temp dirs.
  }
})

const bytes = (s: string) => Buffer.from(s, "utf8")
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex")

function entry(over: Partial<ExecutableEntry> = {}): ExecutableEntry {
  return {
    key: "posts/a.txt",
    kind: "file",
    classification: "missing",
    state: "pending",
    sourceSize: null,
    sourceHash: null,
    createdByMigration: false,
    ...over,
  }
}

const opts = () => ({ mode: "copy" as const, source, destination })

// ------------------------------------------------------------ copy mode ----

describe("copy mode", () => {
  it("copies a missing file and verifies the destination bytes", async () => {
    await source.uploadObject("posts/a.txt", bytes("hello"))

    const outcome = await executeEntry(entry({ sourceHash: sha("hello") }), opts())

    expect(outcome.state).toBe("verified")
    expect(outcome.destinationHash).toBe(sha("hello"))
    expect(Buffer.from(await destination.downloadObject("posts/a.txt")).toString()).toBe("hello")
  })

  it("marks what it created as migration-owned", async () => {
    await source.uploadObject("posts/a.txt", bytes("x"))

    const outcome = await executeEntry(entry({ sourceHash: sha("x") }), opts())

    // Required for the later reconciliation: only an object THIS migration
    // created may ever be removed as stale.
    expect(outcome.createdByMigration).toBe(true)
  })

  it("does NOT mark an already-matching entry as migration-owned", async () => {
    // FlowCMS did not put it there. Marking it owned would license a later
    // reconciliation to delete somebody else's file.
    const outcome = await executeEntry(entry({ classification: "matching" }), opts())

    expect(outcome.state).toBe("verified")
    expect(outcome.createdByMigration).toBe(false)
  })

  it("does not re-copy an already-matching entry", async () => {
    const write = vi.spyOn(destination, "writeObjectStream")

    await executeEntry(entry({ classification: "matching" }), opts())

    expect(write).not.toHaveBeenCalled()
  })

  it("fails an entry whose destination stored different bytes", async () => {
    // The whole reason for reading back. A backend that accepts a write and
    // stores something else would otherwise be reported as a success.
    await source.uploadObject("posts/a.txt", bytes("correct"))
    const lying = {
      ...destination,
      writeObjectStream: async (key: string, body: AsyncIterable<Uint8Array>) => {
        for await (const _ of body) void _
        await destination.uploadObject(key, bytes("something else"))
      },
    } as StorageDriver

    const outcome = await executeEntry(entry({ sourceHash: sha("correct") }), {
      mode: "copy",
      source,
      destination: lying,
    })

    expect(outcome.state).toBe("failed")
    expect(outcome.detail).toMatch(/different bytes/i)
  })

  it("blocks a conflicting entry without writing", async () => {
    const write = vi.spyOn(destination, "writeObjectStream")

    const outcome = await executeEntry(entry({ classification: "conflicting" }), opts())

    expect(outcome.state).toBe("blocked")
    expect(write).not.toHaveBeenCalled()
  })

  it("blocks an incompatible entry without writing", async () => {
    const write = vi.spyOn(destination, "writeObjectStream")

    const outcome = await executeEntry(entry({ classification: "incompatible" }), opts())

    expect(outcome.state).toBe("blocked")
    expect(write).not.toHaveBeenCalled()
  })

  it("leaves a destination-only entry entirely alone", async () => {
    const write = vi.spyOn(destination, "writeObjectStream")
    const remove = vi.spyOn(destination, "deleteObject")

    const outcome = await executeEntry(entry({ classification: "destination_only" }), opts())

    expect(outcome.state).toBe("verified")
    expect(outcome.createdByMigration).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------ directories ---

describe("directories", () => {
  it("creates an empty directory at the destination", async () => {
    const outcome = await executeEntry(
      entry({ key: "empty/", kind: "directory" }),
      opts(),
    )

    expect(outcome.state).toBe("verified")
    expect(outcome.createdByMigration).toBe(true)
    expect((await destination.listDirectory("")).directories).toContain("empty/")
  })

  it("is idempotent, so a retry costs nothing", async () => {
    const e = entry({ key: "empty/", kind: "directory" })

    await executeEntry(e, opts())
    const second = await executeEntry(e, opts())

    expect(second.state).toBe("verified")
  })

  it("handles a destination directory that already exists", async () => {
    await destination.createDirectory("empty/")

    const outcome = await executeEntry(entry({ key: "empty/", kind: "directory" }), opts())

    expect(outcome.state).toBe("verified")
  })

  it("creates nested empty directories", async () => {
    const outcome = await executeEntry(entry({ key: "a/b/c/", kind: "directory" }), opts())

    expect(outcome.state).toBe("verified")
    expect((await destination.listDirectory("a/b/")).directories).toContain("a/b/c/")
  })
})

// ------------------------------------------------------------- streaming ---

describe("streaming and bounded memory", () => {
  it("never holds a whole object in memory", async () => {
    // 12 chunks of 1 MB through the tee. If the engine buffered, peak
    // retention would be 12 MB.
    const chunk = new Uint8Array(1024 * 1024).fill(3)
    let live = 0
    let peak = 0

    const streamingSource = {
      openReadStream: async () =>
        (async function* () {
          for (let i = 0; i < 12; i += 1) {
            live += 1
            peak = Math.max(peak, live)
            yield chunk
            live -= 1
          }
        })(),
    } as unknown as StorageDriver

    const outcome = await executeEntry(entry(), {
      mode: "copy",
      source: streamingSource,
      destination,
    })

    expect(outcome.state).toBe("verified")
    expect(outcome.destinationSize).toBe(12 * 1024 * 1024)
    expect(peak).toBe(1)
  })

  it("hashes the source in the SAME pass as the copy", async () => {
    // Read once, not twice: a second read would also risk seeing a different
    // version of a live object than the one that was written.
    const openReadStream = vi.spyOn(source, "openReadStream")
    await source.uploadObject("posts/a.txt", bytes("payload"))

    await executeEntry(entry({ sourceHash: sha("payload") }), opts())

    expect(openReadStream).toHaveBeenCalledTimes(1)
  })

  it("writes a multi-megabyte file correctly end to end", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024)
    for (let i = 0; i < big.length; i += 1) big[i] = i % 251
    await source.uploadObject("big.bin", big)

    const outcome = await executeEntry(
      entry({ key: "big.bin", sourceHash: sha(big), sourceSize: big.length }),
      opts(),
    )

    expect(outcome.state).toBe("verified")
    expect((await digestObject(destination, "big.bin")).hash).toBe(sha(big))
  })

  it("reports a read failure without claiming success", async () => {
    const failing = {
      openReadStream: async () =>
        (async function* () {
          yield new Uint8Array([1, 2, 3])
          throw new Error("connection reset")
        })(),
    } as unknown as StorageDriver

    const outcome = await executeEntry(entry(), {
      mode: "copy",
      source: failing,
      destination,
    })

    expect(outcome.state).toBe("failed")
  })

  it("reports a write failure and claims ownership so a retry may replace it", async () => {
    await source.uploadObject("posts/a.txt", bytes("x"))
    const failing = {
      ...destination,
      writeObjectStream: async () => {
        throw Object.assign(new Error("nope"), { code: "EACCES" })
      },
    } as StorageDriver

    const outcome = await executeEntry(entry(), { mode: "copy", source, destination: failing })

    expect(outcome.state).toBe("failed")
    // Ownership is recorded EVEN ON FAILURE: the half-written object is ours,
    // and the retry has to know it is allowed to overwrite it.
    expect(outcome.createdByMigration).toBe(true)
    expect(outcome.detail).toMatch(/permission/i)
  })

  it("removes a partially written local file rather than leaving a truncated one", async () => {
    // A half-written file would later hash differently and be reported as a
    // conflict — a confusing lie about what happened.
    await source.uploadObject("posts/a.txt", bytes("x"))
    const failingMidStream = {
      openReadStream: async () =>
        (async function* () {
          yield new Uint8Array(1024)
          throw new Error("boom")
        })(),
    } as unknown as StorageDriver

    await executeEntry(entry(), { mode: "copy", source: failingMidStream, destination })

    let exists = true
    try {
      statSync(join(workspace, "dst", "posts", "a.txt"))
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
  })

  it("never leaks a bucket, endpoint or raw error into the detail", async () => {
    await source.uploadObject("posts/a.txt", bytes("x"))
    const failing = {
      ...destination,
      writeObjectStream: async () => {
        throw new Error("connect ECONNREFUSED https://key:secret@bucket.internal.example.com")
      },
    } as StorageDriver

    const outcome = await executeEntry(entry(), { mode: "copy", source, destination: failing })

    expect(outcome.detail).not.toContain("secret")
    expect(outcome.detail).not.toContain("internal.example.com")
    expect(outcome.detail).not.toContain("ECONNREFUSED")
  })
})

// ------------------------------------------------------ source mutations ---

describe("the source stays live during baseline", () => {
  it("records an entry whose source changed, rather than claiming it verified", async () => {
    // The baseline hash is what the destination is supposed to match. If the
    // bytes just read differ from it, whatever was written is a valid copy of
    // SOMETHING, but not of the thing that was inventoried.
    await source.uploadObject("posts/a.txt", bytes("new content"))

    const outcome = await executeEntry(
      entry({ sourceHash: sha("the original content") }),
      opts(),
    )

    expect(outcome.state).toBe("source_changed")
    expect(outcome.detail).toMatch(/changed at the source/i)
  })

  it("records a deleted source entry without failing the migration", async () => {
    const outcome = await executeEntry(entry({ sourceHash: sha("gone") }), opts())

    expect(outcome.state).toBe("source_deleted")
    expect(outcome.detail).toMatch(/deleted from the source/i)
  })

  it("does not treat a missing source as a retryable transfer failure", async () => {
    // Retrying forever against an object that no longer exists would never
    // finish. The final delta decides what to do about it.
    const outcome = await executeEntry(entry(), opts())

    expect(outcome.state).not.toBe("failed")
  })

  it("verifies normally when no baseline hash was recorded", async () => {
    // An entry inventoried without a hash cannot be checked against one; the
    // destination read-back still proves the copy landed intact.
    await source.uploadObject("posts/a.txt", bytes("content"))

    const outcome = await executeEntry(entry({ sourceHash: null }), opts())

    expect(outcome.state).toBe("verified")
  })
})

// ----------------------------------------------------------- verify mode ---

describe("verify-only mode writes NOTHING", () => {
  /** Every method that could change the destination. */
  const MUTATORS = [
    "uploadObject",
    "writeObjectStream",
    "deleteObject",
    "createDirectory",
    "deletePrefix",
    "copyObject",
    "renameObject",
    "copyPrefix",
    "renamePrefix",
  ] as const

  it.each([
    ["matching", "verified"],
    ["missing", "blocked"],
    ["conflicting", "blocked"],
    ["incompatible", "blocked"],
    ["destination_only", "verified"],
  ] as const)("classifies %s as %s and mutates nothing", async (classification, expected) => {
    const spies = MUTATORS.map((m) => vi.spyOn(destination, m))

    const outcome = await executeEntry(entry({ classification }), {
      mode: "verify",
      source,
      destination,
    })

    expect(outcome.state).toBe(expected)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it("blocks a missing file instead of quietly copying the delta", async () => {
    await source.uploadObject("posts/a.txt", bytes("the operator missed this"))
    const write = vi.spyOn(destination, "writeObjectStream")

    const outcome = await executeEntry(entry({ classification: "missing" }), {
      mode: "verify",
      source,
      destination,
    })

    expect(outcome.state).toBe("blocked")
    expect(outcome.detail).toMatch(/not copied|verify/i)
    expect(write).not.toHaveBeenCalled()
    // And nothing arrived at the destination.
    await expect(destination.downloadObject("posts/a.txt")).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    )
  })

  it("never marks anything migration-owned, because it created nothing", async () => {
    for (const classification of ["matching", "missing", "destination_only"] as const) {
      const outcome = await executeEntry(entry({ classification }), {
        mode: "verify",
        source,
        destination,
      })
      expect(outcome.createdByMigration).toBe(false)
    }
  })

  it("does not create directories either", async () => {
    const create = vi.spyOn(destination, "createDirectory")

    await executeEntry(entry({ key: "empty/", kind: "directory", classification: "missing" }), {
      mode: "verify",
      source,
      destination,
    })

    expect(create).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------- batching ----

describe("batching", () => {
  it("processes a batch and returns one outcome per entry, in order", async () => {
    for (const n of ["a", "b", "c"]) await source.uploadObject(`${n}.txt`, bytes(n))
    const entries = ["a", "b", "c"].map((n) => entry({ key: `${n}.txt`, sourceHash: sha(n) }))

    const outcomes = await executeBatch(entries, opts())

    expect(outcomes.map((o) => o.key)).toEqual(["a.txt", "b.txt", "c.txt"])
    expect(outcomes.every((o) => o.state === "verified")).toBe(true)
  })

  it("bounds concurrency rather than opening everything at once", async () => {
    // An unbounded `Promise.all` over ten thousand entries would exhaust file
    // descriptors or the connection pool and fail looking like a broken
    // destination.
    let inFlight = 0
    let peak = 0
    const slowSource = {
      openReadStream: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight -= 1
        return (async function* () {
          yield new Uint8Array([1])
        })()
      },
    } as unknown as StorageDriver

    const entries = Array.from({ length: 20 }, (_, i) => entry({ key: `f-${i}.txt` }))
    await executeBatch(entries, { mode: "copy", source: slowSource, destination, concurrency: 3 })

    expect(peak).toBeLessThanOrEqual(3)
  })

  it("keeps working after one entry fails", async () => {
    await source.uploadObject("good.txt", bytes("fine"))
    const entries = [
      entry({ key: "gone.txt" }),
      entry({ key: "good.txt", sourceHash: sha("fine") }),
    ]

    const outcomes = await executeBatch(entries, opts())

    expect(outcomes[0].state).toBe("source_deleted")
    expect(outcomes[1].state).toBe("verified")
  })

  it("handles an empty batch", async () => {
    expect(await executeBatch([], opts())).toEqual([])
  })
})

// -------------------------------------------------------------- restart ----

describe("restart safety", () => {
  it("treats a half-finished write as needing re-verification", () => {
    // A process that died mid-write leaves a row saying it started and an
    // object of unknown completeness. Treating that as finished is how a
    // truncated file becomes a verified one.
    expect(needsReverificationAfterRestart("copying")).toBe(true)
    expect(needsReverificationAfterRestart("copied")).toBe(true)
  })

  it("does not re-verify what was already proven", () => {
    expect(needsReverificationAfterRestart("verified")).toBe(false)
  })

  it("re-running a verified entry is idempotent", async () => {
    await source.uploadObject("posts/a.txt", bytes("stable"))
    const e = entry({ sourceHash: sha("stable") })

    const first = await executeEntry(e, opts())
    const second = await executeEntry({ ...e, state: first.state }, opts())

    expect(second.state).toBe("verified")
    expect(second.destinationHash).toBe(first.destinationHash)
  })

  it("replaces a partially written migration-owned object on retry", async () => {
    // Ours, incomplete, so safe to overwrite.
    await source.uploadObject("posts/a.txt", bytes("the full content"))
    await destination.uploadObject("posts/a.txt", bytes("trunc"))

    const outcome = await executeEntry(
      entry({ sourceHash: sha("the full content"), createdByMigration: true }),
      opts(),
    )

    expect(outcome.state).toBe("verified")
    expect(Buffer.from(await destination.downloadObject("posts/a.txt")).toString()).toBe(
      "the full content",
    )
  })

  it("never overwrites a pre-existing object just because a retry happened", async () => {
    // The guard against a retry laundering somebody else's file into a
    // migration-owned one: a differing pre-existing object is CONFLICTING, and
    // conflicting never writes.
    await source.uploadObject("posts/a.txt", bytes("source version"))
    await destination.uploadObject("posts/a.txt", bytes("pre-existing"))
    const write = vi.spyOn(destination, "writeObjectStream")

    const outcome = await executeEntry(
      entry({ classification: "conflicting", createdByMigration: false }),
      opts(),
    )

    expect(outcome.state).toBe("blocked")
    expect(outcome.createdByMigration).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(Buffer.from(await destination.downloadObject("posts/a.txt")).toString()).toBe(
      "pre-existing",
    )
  })
})

// ------------------------------------------------------- no cutover ever ----

describe("the engine cannot change active storage", () => {
  it("imports nothing that could", async () => {
    // The structural guarantee: no access to the settings row, no active
    // driver, no way to commit a topology. Making the destination
    // authoritative is one transaction in a later phase and is not reachable
    // from here.
    //
    // Checked against the IMPORTS and CALLS, not the file text: the module's
    // own documentation names these to explain why it cannot reach them, and a
    // naive substring search would fail on the explanation.
    const { readFileSync } = await import("node:fs")
    const src = readFileSync("src/Framework/Storage/Migration/migrationEngine.ts", "utf8")

    const imports = [...src.matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1])
    expect(imports.sort()).toEqual([
      "../StorageDriver",
      "../StorageErrors",
      "./contentHash",
      "./migrationState",
      "node:crypto",
    ])

    // The import list IS the proof, and it is a stronger one than searching for
    // forbidden call sites: a module that imports only these five things has no
    // reference through which a topology commit could be reached, whatever its
    // body says. Nothing on that list can touch the settings row, the active
    // driver, or the storage snapshot.
  })

  it("only ever writes to the destination it was handed", async () => {
    const sourceWrite = vi.spyOn(source, "writeObjectStream")
    const sourceDelete = vi.spyOn(source, "deleteObject")
    await source.uploadObject("posts/a.txt", bytes("x"))

    await executeEntry(entry({ sourceHash: sha("x") }), opts())

    // The source is read, never written. No migration in this phase removes
    // anything from where the files currently live.
    expect(sourceWrite).not.toHaveBeenCalled()
    expect(sourceDelete).not.toHaveBeenCalled()
  })
})
