import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createLocalStorageDriver } from "@/Framework/Storage/drivers/LocalStorageDriver"
import { S3StorageDriver } from "@/Framework/Storage/drivers/S3StorageDriver"
import { StorageService } from "@/Framework/Storage/StorageService"

/**
 * THE FINAL STORAGE CONTRACT, PINNED.
 *
 *     StorageService
 *           |
 *     resolve active topology
 *           |
 *      StorageDriver
 *        /       \
 *     Local       S3        (Garage is an S3-compatible SERVER, reached
 *                            through the S3 driver — never a driver of its own)
 *
 * The refactor's whole claim is that the File Manager, the media routes and the
 * public image route work unmodified on either backend. That claim survives
 * only while the contract stays provider-neutral, and the way it decays is not
 * dramatic: somebody needs a bucket name for one feature, adds `getBucket()`,
 * and a year later the filesystem driver has six methods that throw.
 *
 * So the surface is enumerated exactly. Adding a method is a deliberate act
 * that shows up here as a failing test, with a reviewer asking what the
 * filesystem implementation of it is.
 */

/** Every method both drivers must implement, and nothing else. */
const DRIVER_CONTRACT = [
  // Objects
  "uploadObject",
  "downloadObject",
  "deleteObject",
  "copyObject",
  "renameObject",
  // Prefixes / folders
  "listObjects",
  "listDirectory",
  "createDirectory",
  "deletePrefix",
  "copyPrefix",
  "renamePrefix",
  // Streaming and enumeration — used only by migration, but implemented
  // coherently by BOTH drivers, which is what makes them part of the contract
  // rather than an S3 escape hatch.
  "scanEntries",
  "openReadStream",
  "writeObjectStream",
  // Which backend this is. Reported, never branched on outside
  // `resolveStorageDriver` — it exists so a log line or a status response can
  // say which driver answered.
  "name",
].sort()

/** What `StorageService` dispatches. Same vocabulary, plus the write gate. */
const SERVICE_CONTRACT = [
  "uploadObject",
  "downloadObject",
  "deleteObject",
  "listObjects",
  "listDirectory",
  "createDirectory",
  "deletePrefix",
  "renamePrefix",
  "copyPrefix",
  "copyObject",
  "renameObject",
].sort()

let workspace: string

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-contract-"))
})

afterAll(() => {
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // Windows holds handles briefly.
  }
})

describe("both drivers implement the same contract, exactly", () => {
  it("the local driver implements every method and no extras", () => {
    const driver = createLocalStorageDriver(join(workspace, "local"))

    expect(Object.keys(driver).sort()).toEqual(DRIVER_CONTRACT)
  })

  it("the s3 driver implements every method and no extras", () => {
    expect(Object.keys(S3StorageDriver).sort()).toEqual(DRIVER_CONTRACT)
  })

  it("neither driver exposes anything provider-specific", () => {
    // The named absences. Each of these existed, or was proposed, at some point
    // in the refactor, and each would have made the contract S3-shaped:
    //
    //   getPresignedDownloadUrl  handed the browser a URL pointing straight at
    //                            the object store — unreachable on bundled
    //                            Garage and meaningless for a filesystem
    //   getBucket / getEndpoint  an object-store concept with no local answer
    //   getAbsolutePath          a filesystem concept with no S3 answer
    //   send / client            the AWS command surface, leaking upward
    const forbidden = [
      "getPresignedDownloadUrl",
      "getPresignedUploadUrl",
      "getSignedUrl",
      "getBucket",
      "getEndpoint",
      "getRegion",
      "getAbsolutePath",
      "getRoot",
      "send",
      "client",
    ]

    const local = createLocalStorageDriver(join(workspace, "local2"))
    for (const name of forbidden) {
      expect(name in local, `local driver exposes ${name}`).toBe(false)
      expect(name in S3StorageDriver, `s3 driver exposes ${name}`).toBe(false)
    }
  })
})

describe("StorageService is the dispatcher, and nothing more", () => {
  it("exposes exactly the operations the application needs", () => {
    expect(Object.keys(StorageService).sort()).toEqual(SERVICE_CONTRACT)
  })

  it("never lets the caller choose a driver", () => {
    // Which backend serves a request is resolved from the durable active
    // topology, in one place. A `StorageService.using(driver)` would make that
    // a per-call decision and every caller a place where it could be wrong.
    for (const name of ["using", "withDriver", "forBucket", "s3", "local"]) {
      expect(name in StorageService, `StorageService exposes ${name}`).toBe(false)
    }
  })
})

describe("the seam holds in the code, not only in the types", () => {
  it("resolves the driver in exactly one place", () => {
    // `resolveStorageDriver` is the only branch on which backend is active.
    // A second one would be a second answer to "where do the files live".
    const files = sourceFiles("src").filter(
      (f) => !f.includes("Framework/Storage/resolveStorageDriver"),
    )
    const offenders = files.filter((file) => {
      const code = stripComments(readFileSync(file, "utf8"))
      // Branching on the driver name outside the storage framework itself.
      return (
        /config\.driver\s*===\s*"(s3|local)"/.test(code) &&
        !file.includes("Framework/Storage")
      )
    })

    expect(offenders).toEqual([])
  })

  it("keeps the AWS SDK inside the s3 driver", () => {
    const offenders = sourceFiles("src").filter((file) => {
      if (file.includes("Framework/Storage/drivers")) return false
      return /@aws-sdk\//.test(stripComments(readFileSync(file, "utf8")))
    })

    expect(offenders).toEqual([])
  })

  it("keeps `node:fs` out of everything except the local driver and its path guard", () => {
    const allowed = [
      "Framework/Storage/drivers/LocalStorageDriver",
      "Framework/Storage/localPath",
      "Framework/Storage/Migration/compatibility",
    ]
    const offenders = sourceFiles("src/Framework/Storage").filter((file) => {
      if (allowed.some((a) => file.replace(/\\/g, "/").includes(a))) return false
      return /from "node:fs/.test(stripComments(readFileSync(file, "utf8")))
    })

    expect(offenders).toEqual([])
  })

  it("says nothing about Garage anywhere in the driver layer", () => {
    // Garage is infrastructure reached through the s3 driver. The driver
    // cannot tell it apart from AWS or R2, which is exactly what lets an
    // operator move between them.
    const offenders = sourceFiles("src/Framework/Storage/drivers").filter((file) =>
      /garage/i.test(stripComments(readFileSync(file, "utf8"))),
    )

    expect(offenders).toEqual([])
  })
})

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

/**
 * Every source file under `root`, with FORWARD SLASHES.
 *
 * The normalisation is load-bearing rather than tidy: every exclusion above
 * compares against a forward-slash path, and on Windows `join` produces
 * backslashes — so an unnormalised path matches no exclusion, every allowed
 * file reads as an offender, and the assertions fail for a reason that has
 * nothing to do with the code they are checking.
 */
function sourceFiles(root: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root)) {
    const full = join(root, entry).replace(/\\/g, "/")
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}
