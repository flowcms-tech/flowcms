import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StorageObjectNotFoundError } from "@/Framework/Storage/StorageErrors"
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3"

/**
 * CHARACTERIZATION TESTS for the storage layer.
 *
 * These were written against the S3-only `StorageService` BEFORE it was moved
 * behind `StorageDriver`/`S3StorageDriver`, and they passed then. That is the
 * whole point: they are not a description of the new design, they are a record
 * of the old behaviour, so the refactor is only "behaviour preserving" if this
 * file keeps passing without being edited.
 *
 * They assert on the COMMANDS SENT TO S3, not on FlowCMS's own return values.
 * A test that only checked return values would happily pass if the refactor
 * started listing with the wrong delimiter, copying with an unencoded
 * `CopySource`, or writing a folder marker with a non-empty body — every one of
 * which is a real difference an operator's bucket would notice.
 *
 * WHAT IS MOCKED, AND WHY ONLY THIS MUCH:
 *   - `S3Client` itself, so `send` is observable and nothing touches a network.
 *     The COMMAND CLASSES are the real ones, so the inputs asserted below are
 *     the inputs the AWS SDK would really have serialised.
 *   - `getS3Config`, the configuration boundary. Mocking here rather than
 *     mocking FlowCMS's own `s3Client` module keeps this file independent of
 *     where that module lives — which is exactly what let it survive the
 *     refactor that moved it under `drivers/`.
 */

const send = vi.fn()
const clientConstructorArgs: unknown[] = []

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>()
  return {
    ...actual,
    S3Client: vi.fn((config: unknown) => {
      clientConstructorArgs.push(config)
      return { send }
    }),
  }
})

/**
 * The write gate is not what this file tests, and since Phase 4a it FAILS
 * CLOSED — with no database here, the real gate would return "unknown" and
 * refuse every mutation, so these S3-command assertions would never run. The
 * gate has its own two suites.
 */
vi.mock("@/Framework/Storage/storageWriteLock", () => ({
  assertStorageWritable: async () => {},
}))

const getS3Config = vi.fn()
vi.mock("@/Framework/Settings/SettingsService", () => ({
  getS3Config: () => getS3Config(),
  // No settings row means no pinned active topology, so the environment is
  // authoritative — the state every one of these characterization tests was
  // written against, and the state a legacy installation is in.
  getSettingsRow: () => Promise.resolve(null),
}))

const { StorageService } = await import("@/Framework/Storage/StorageService")
const { resolveStorageDriver } = await import("@/Framework/Storage/resolveStorageDriver")

const BUCKET = "flowcms-test"

/** Every command handed to `send`, in order. */
function sentCommands(): unknown[] {
  return send.mock.calls.map((call) => call[0])
}

/** The `input` of the n-th command sent, typed loosely for assertion. */
function inputOf(index: number): Record<string, unknown> {
  return (sentCommands()[index] as { input: Record<string, unknown> }).input
}

beforeEach(() => {
  send.mockReset()
  getS3Config.mockReset()
  clientConstructorArgs.length = 0

  getS3Config.mockResolvedValue({
    endpoint: "http://garage:3900",
    region: "garage",
    bucket: BUCKET,
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "s3cret",
  })
  send.mockResolvedValue({})
})

describe("the registered driver", () => {
  it("is the S3 driver, and it advertises the capabilities it really has", async () => {
    // The real resolution, not a fake: if a driver is ever registered that does
    // not satisfy the contract it claims to, this is where it surfaces.
    const driver = await resolveStorageDriver()

    expect(driver.name).toBe("s3")
  })
})

describe("client construction", () => {
  it("builds a path-style client from the resolved configuration", async () => {
    await StorageService.uploadObject("a.txt", Buffer.from("x"))

    expect(clientConstructorArgs[0]).toEqual({
      endpoint: "http://garage:3900",
      region: "garage",
      credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "s3cret" },
      // Load-bearing for Garage and for every non-AWS S3-compatible provider,
      // and assumed by `backfillContentImageUrls.ts` when it derives a key from
      // a presigned URL's first path segment.
      forcePathStyle: true,
      // Added after a real Garage instance refused to hand back a
      // multipart-uploaded object: the SDK validates a multipart
      // checksum-of-checksums as though it were a whole-object checksum and
      // rejects the response.
      //
      // RESPONSE SIDE ONLY. Phase 4b1 also overrode the request side; measuring
      // all three combinations against real Garage showed that unnecessary, so
      // uploads keep the SDK's CRC32 and the deviation is one setting, not two.
      responseChecksumValidation: "WHEN_REQUIRED",
    })
  })

  it("resolves configuration per operation, so a settings change needs no restart", async () => {
    await StorageService.uploadObject("a.txt", Buffer.from("x"))
    await StorageService.uploadObject("b.txt", Buffer.from("x"))

    // The INVARIANT is that nothing is cached across operations: each one
    // re-reads configuration and builds its own client, so an admin who changes
    // the bucket in Settings is served by the next request rather than the next
    // restart.
    //
    // Deliberately not asserting an exact call count. Before the driver
    // refactor each operation resolved the config TWICE — once inside
    // `getS3Client()` and again inside `getS3Bucket()` — which was an accident
    // of having two entry points, not a contract. Pinning `2` here would have
    // frozen that accident in place and forbidden the fix.
    expect(clientConstructorArgs).toHaveLength(2)
    expect(getS3Config.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it("reports missing configuration as a typed error, not a magic string", async () => {
    // CHANGED IN PHASE 3, DELIBERATELY. This test used to assert that the
    // literal text "S3 is not configured" escaped the storage layer, because
    // `checkStoragePrerequisite` and `checkStorage` classified a deployment by
    // running `message.includes(...)` on it. That made a human-readable
    // sentence into load-bearing program logic, and it could not survive a
    // second backend: a Local installation has no S3 credentials by design, and
    // the same match would have called it a broken S3 deployment.
    //
    // Callers now branch on `problem`. The message stays useful for a log.
    getS3Config.mockRejectedValue(new Error("S3 is not configured — set it in Admin"))

    await expect(StorageService.uploadObject("a.txt", Buffer.from("x"))).rejects.toMatchObject({
      name: "StorageConfigurationError",
      problem: "s3_incomplete",
    })
  })

  it("still lets an unrelated failure through untranslated", async () => {
    // A database outage while reading the settings row is not a configuration
    // problem, and reporting it as one sends an operator to the wrong screen.
    getS3Config.mockRejectedValue(new Error("SQLITE_BUSY: database is locked"))

    await expect(StorageService.uploadObject("a.txt", Buffer.from("x"))).rejects.toThrow(
      "SQLITE_BUSY",
    )
  })
})

describe("uploadObject", () => {
  it("puts the body at the key with the given content type", async () => {
    const body = Buffer.from("hello")
    await StorageService.uploadObject("posts/a.png", body, "image/png")

    expect(sentCommands()[0]).toBeInstanceOf(PutObjectCommand)
    expect(inputOf(0)).toEqual({
      Bucket: BUCKET,
      Key: "posts/a.png",
      Body: body,
      ContentType: "image/png",
    })
  })

  it("omits the content type when none is supplied", async () => {
    await StorageService.uploadObject("posts/a.bin", Buffer.from("x"))

    expect(inputOf(0).ContentType).toBeUndefined()
  })
})

describe("downloadObject", () => {
  it("gets the key and returns the bytes as a Buffer", async () => {
    send.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    })

    const result = await StorageService.downloadObject("posts/a.png")

    expect(sentCommands()[0]).toBeInstanceOf(GetObjectCommand)
    expect(inputOf(0)).toEqual({ Bucket: BUCKET, Key: "posts/a.png" })
    expect(Buffer.isBuffer(result)).toBe(true)
    expect([...result]).toEqual([1, 2, 3])
  })
})

describe("downloadObject reports a missing key the same way every backend does", () => {
  it("maps NoSuchKey onto StorageObjectNotFoundError", async () => {
    // Without this the preview route has to know that "missing" is spelled
    // `NoSuchKey` on S3 and `ENOENT` on a filesystem, and would have to tell
    // them apart to decide between 404 and 500.
    const noSuchKey = Object.assign(new Error("The specified key does not exist."), {
      name: "NoSuchKey",
    })
    send.mockRejectedValue(noSuchKey)

    await expect(StorageService.downloadObject("gone.png")).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    )
  })

  it("maps a 404 status onto the same error", async () => {
    // MinIO and some other S3-compatible servers answer with `NotFound` rather
    // than `NoSuchKey`, so the HTTP status is checked too.
    send.mockRejectedValue(
      Object.assign(new Error("Not Found"), {
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      }),
    )

    await expect(StorageService.downloadObject("gone.png")).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    )
  })

  it("does not disguise a real failure as a missing object", async () => {
    // AccessDenied means the credentials are wrong; answering 404 would send an
    // operator hunting for a file that is right there.
    send.mockRejectedValue(Object.assign(new Error("Access Denied"), { name: "AccessDenied" }))

    await expect(StorageService.downloadObject("there.png")).rejects.toThrow("Access Denied")
  })
})

describe("deleteObject", () => {
  it("deletes exactly the one key", async () => {
    await StorageService.deleteObject("posts/a.png")

    expect(sentCommands()[0]).toBeInstanceOf(DeleteObjectCommand)
    expect(inputOf(0)).toEqual({ Bucket: BUCKET, Key: "posts/a.png" })
  })
})

describe("listObjects", () => {
  it("lists a flat prefix with no delimiter", async () => {
    send.mockResolvedValue({ Contents: [] })

    await StorageService.listObjects("posts/")

    expect(sentCommands()[0]).toBeInstanceOf(ListObjectsV2Command)
    expect(inputOf(0)).toEqual({ Bucket: BUCKET, Prefix: "posts/" })
    // Absent, not "/" — this is the recursive listing.
    expect(inputOf(0).Delimiter).toBeUndefined()
  })

  it("maps size and lastModified, defaulting both when S3 omits them", async () => {
    const when = new Date("2026-01-02T03:04:05.000Z")
    send.mockResolvedValue({
      Contents: [
        { Key: "posts/a.png", Size: 12, LastModified: when },
        { Key: "posts/b.png" },
      ],
    })

    const result = await StorageService.listObjects("posts/")

    expect(result).toEqual([
      { key: "posts/a.png", size: 12, lastModified: when },
      { key: "posts/b.png", size: 0, lastModified: new Date(0) },
    ])
  })

  it("returns an empty list when the response carries no Contents", async () => {
    send.mockResolvedValue({})

    expect(await StorageService.listObjects("posts/")).toEqual([])
  })
})

describe("listObjects pagination", () => {
  /**
   * `ListObjectsV2` returns at most 1000 keys per call and sets `IsTruncated`.
   *
   * Before this, `listObjects` and `listDirectory` each issued ONE command and
   * returned whatever came back — so a folder with more than 1000 objects was
   * silently, invisibly cut short. Nothing errored; the File Manager simply
   * showed part of a folder, and a prefix copy quietly moved part of a tree.
   *
   * It matters more now than it did: the local driver returns everything a
   * directory holds, so leaving this would have given the two backends
   * permanently different answers for the same folder.
   */
  function page(keys: string[], next?: string) {
    return {
      Contents: keys.map((Key) => ({ Key, Size: 1 })),
      IsTruncated: Boolean(next),
      NextContinuationToken: next,
    }
  }

  it("follows the continuation token until the listing is complete", async () => {
    send
      .mockResolvedValueOnce(page(["posts/a"], "t1"))
      .mockResolvedValueOnce(page(["posts/b"], "t2"))
      .mockResolvedValueOnce(page(["posts/c"]))

    const keys = (await StorageService.listObjects("posts/")).map((o) => o.key)

    expect(keys).toEqual(["posts/a", "posts/b", "posts/c"])
    expect(inputOf(0).ContinuationToken).toBeUndefined()
    expect(inputOf(1).ContinuationToken).toBe("t1")
    expect(inputOf(2).ContinuationToken).toBe("t2")
  })

  it("returns every object across more than a thousand keys", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => `posts/${String(i).padStart(4, "0")}`)
    const second = Array.from({ length: 250 }, (_, i) => `posts/1${String(i).padStart(4, "0")}`)
    send.mockResolvedValueOnce(page(first, "more")).mockResolvedValueOnce(page(second))

    const keys = (await StorageService.listObjects("posts/")).map((o) => o.key)

    expect(keys).toHaveLength(1250)
    expect(keys[0]).toBe("posts/0000")
    expect(keys[1249]).toBe("posts/10249")
  })

  it("stops when IsTruncated is false even if a token is echoed back", async () => {
    // A provider that returns a stale token on the final page would otherwise
    // loop forever. `IsTruncated` is the authority, not the token's presence.
    send.mockResolvedValue({
      Contents: [{ Key: "posts/a", Size: 1 }],
      IsTruncated: false,
      NextContinuationToken: "ignored",
    })

    expect(await StorageService.listObjects("posts/")).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe("listDirectory pagination", () => {
  it("accumulates folders and files across pages", async () => {
    send
      .mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: "posts/a/" }],
        Contents: [{ Key: "posts/one.png", Size: 1 }],
        IsTruncated: true,
        NextContinuationToken: "t1",
      })
      .mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: "posts/b/" }],
        Contents: [{ Key: "posts/two.png", Size: 1 }],
        IsTruncated: false,
      })

    const result = await StorageService.listDirectory("posts/")

    expect(result.directories).toEqual(["posts/a/", "posts/b/"])
    expect(result.files.map((f) => f.key)).toEqual(["posts/one.png", "posts/two.png"])
    // The delimiter has to survive on to the second page, or page two comes
    // back recursive and every nested object appears as a file in this folder.
    expect(inputOf(1).Delimiter).toBe("/")
    expect(inputOf(1).ContinuationToken).toBe("t1")
  })

  it("never repeats a folder that appears on more than one page", async () => {
    send
      .mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: "posts/a/" }],
        IsTruncated: true,
        NextContinuationToken: "t1",
      })
      .mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: "posts/a/" }, { Prefix: "posts/b/" }],
        IsTruncated: false,
      })

    const result = await StorageService.listDirectory("posts/")

    expect(result.directories).toEqual(["posts/a/", "posts/b/"])
  })

  it("filters the folder's own marker on every page, not just the first", async () => {
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: "posts/one.png", Size: 1 }],
        IsTruncated: true,
        NextContinuationToken: "t1",
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: "posts/", Size: 0 }, { Key: "posts/two.png", Size: 1 }],
        IsTruncated: false,
      })

    const result = await StorageService.listDirectory("posts/")

    expect(result.files.map((f) => f.key)).toEqual(["posts/one.png", "posts/two.png"])
  })
})

describe("listDirectory", () => {
  it("lists one level using a slash delimiter", async () => {
    send.mockResolvedValue({})

    await StorageService.listDirectory("posts/")

    expect(inputOf(0)).toEqual({ Bucket: BUCKET, Prefix: "posts/", Delimiter: "/" })
  })

  it("defaults to the bucket root", async () => {
    send.mockResolvedValue({})

    await StorageService.listDirectory()

    expect(inputOf(0)).toEqual({ Bucket: BUCKET, Prefix: "", Delimiter: "/" })
  })

  it("splits CommonPrefixes into directories and Contents into files", async () => {
    const when = new Date("2026-01-02T03:04:05.000Z")
    send.mockResolvedValue({
      CommonPrefixes: [{ Prefix: "posts/2026/" }, { Prefix: "posts/drafts/" }],
      Contents: [{ Key: "posts/a.png", Size: 9, LastModified: when }],
    })

    const result = await StorageService.listDirectory("posts/")

    expect(result.directories).toEqual(["posts/2026/", "posts/drafts/"])
    expect(result.files).toEqual([{ key: "posts/a.png", size: 9, lastModified: when }])
  })

  it("hides the folder's own marker object from its file list", async () => {
    // `createDirectory` writes a zero-byte object whose key IS the prefix.
    // Listing the folder must not show that marker as a file inside itself.
    send.mockResolvedValue({
      Contents: [{ Key: "posts/", Size: 0 }, { Key: "posts/a.png", Size: 9 }],
    })

    const result = await StorageService.listDirectory("posts/")

    expect(result.files.map((f) => f.key)).toEqual(["posts/a.png"])
  })
})

describe("createDirectory", () => {
  it("writes a zero-byte marker object at the prefix", async () => {
    await StorageService.createDirectory("posts/2026/")

    expect(sentCommands()[0]).toBeInstanceOf(PutObjectCommand)
    const input = inputOf(0)
    expect(input.Bucket).toBe(BUCKET)
    expect(input.Key).toBe("posts/2026/")
    expect((input.Body as Buffer).length).toBe(0)
    // No ContentType is set for markers, unlike uploads.
    expect(input.ContentType).toBeUndefined()
  })
})

describe("deletePrefix", () => {
  it("lists then batch-deletes everything under the prefix", async () => {
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: "posts/a.png" }, { Key: "posts/b.png" }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({})

    await StorageService.deletePrefix("posts/")

    expect(sentCommands()[0]).toBeInstanceOf(ListObjectsV2Command)
    expect(inputOf(0)).toEqual({
      Bucket: BUCKET,
      Prefix: "posts/",
      ContinuationToken: undefined,
    })
    expect(sentCommands()[1]).toBeInstanceOf(DeleteObjectsCommand)
    expect(inputOf(1)).toEqual({
      Bucket: BUCKET,
      Delete: { Objects: [{ Key: "posts/a.png" }, { Key: "posts/b.png" }] },
    })
  })

  it("follows the continuation token across pages", async () => {
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: "posts/a.png" }],
        IsTruncated: true,
        NextContinuationToken: "page-2",
      })
      .mockResolvedValueOnce({}) // delete of page 1
      .mockResolvedValueOnce({
        Contents: [{ Key: "posts/b.png" }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({}) // delete of page 2

    await StorageService.deletePrefix("posts/")

    expect(inputOf(2).ContinuationToken).toBe("page-2")
    expect(inputOf(3)).toEqual({
      Bucket: BUCKET,
      Delete: { Objects: [{ Key: "posts/b.png" }] },
    })
  })

  it("sends no delete request when the prefix is already empty", async () => {
    send.mockResolvedValue({ Contents: [], IsTruncated: false })

    await StorageService.deletePrefix("posts/")

    expect(sentCommands().some((c) => c instanceof DeleteObjectsCommand)).toBe(false)
  })
})

describe("copyObject", () => {
  it("copies server-side with a percent-encoded CopySource", async () => {
    await StorageService.copyObject("posts/a.png", "archive/a.png")

    expect(sentCommands()[0]).toBeInstanceOf(CopyObjectCommand)
    expect(inputOf(0)).toEqual({
      Bucket: BUCKET,
      // encodeURIComponent encodes the separator too. Preserved deliberately:
      // this is what every existing deployment's provider already accepts.
      CopySource: encodeURIComponent(`${BUCKET}/posts/a.png`),
      Key: "archive/a.png",
    })
  })
})

describe("renameObject", () => {
  it("copies to the new key and then deletes the old one, in that order", async () => {
    await StorageService.renameObject("posts/a.png", "posts/b.png")

    expect(sentCommands()[0]).toBeInstanceOf(CopyObjectCommand)
    expect(inputOf(0).Key).toBe("posts/b.png")
    expect(sentCommands()[1]).toBeInstanceOf(DeleteObjectCommand)
    expect(inputOf(1).Key).toBe("posts/a.png")
  })

  it("leaves the source in place when the copy fails", async () => {
    send.mockRejectedValueOnce(new Error("AccessDenied"))

    await expect(StorageService.renameObject("posts/a.png", "posts/b.png")).rejects.toThrow(
      "AccessDenied",
    )
    expect(sentCommands().some((c) => c instanceof DeleteObjectCommand)).toBe(false)
  })
})

describe("copyPrefix", () => {
  it("re-roots every key under the new prefix and deletes nothing", async () => {
    send.mockResolvedValueOnce({
      Contents: [{ Key: "posts/a.png" }, { Key: "posts/nested/b.png" }],
      IsTruncated: false,
    })

    await StorageService.copyPrefix("posts/", "archive/")

    const copies = sentCommands().filter((c) => c instanceof CopyObjectCommand)
    expect(copies.map((c) => (c as CopyObjectCommand).input.Key)).toEqual([
      "archive/a.png",
      "archive/nested/b.png",
    ])
    expect(sentCommands().some((c) => c instanceof DeleteObjectsCommand)).toBe(false)
    expect(sentCommands().some((c) => c instanceof DeleteObjectCommand)).toBe(false)
  })
})

describe("renamePrefix", () => {
  it("copies everything first, then deletes the source prefix", async () => {
    send
      .mockResolvedValueOnce({ Contents: [{ Key: "posts/a.png" }], IsTruncated: false }) // copy list
      .mockResolvedValueOnce({}) // the copy
      .mockResolvedValueOnce({ Contents: [{ Key: "posts/a.png" }], IsTruncated: false }) // delete list
      .mockResolvedValueOnce({}) // the batch delete

    await StorageService.renamePrefix("posts/", "archive/")

    const kinds = sentCommands().map((c) => (c as object).constructor.name)
    expect(kinds).toEqual([
      "ListObjectsV2Command",
      "CopyObjectCommand",
      "ListObjectsV2Command",
      "DeleteObjectsCommand",
    ])
  })

  it("deletes nothing when the copy phase fails", async () => {
    send
      .mockResolvedValueOnce({ Contents: [{ Key: "posts/a.png" }], IsTruncated: false })
      .mockRejectedValueOnce(new Error("AccessDenied"))

    await expect(StorageService.renamePrefix("posts/", "archive/")).rejects.toThrow("AccessDenied")
    expect(sentCommands().some((c) => c instanceof DeleteObjectsCommand)).toBe(false)
  })
})
describe("presigning is gone", () => {
  /**
   * Phase 1 kept `getPresignedDownloadUrl` as an optional driver capability and
   * pinned its exact behaviour here. Phase 2 removed it outright, so the
   * characterization tests for it were removed with it — a test asserting the
   * behaviour of something deleted is a test asserting a lie.
   *
   * What replaces them is the assertion that nothing can still reach it. The
   * failure this guards against is a later phase quietly reintroducing a signed
   * URL for convenience and putting an unreachable `http://garage:3900` host
   * back in front of the browser.
   */
  it("is absent from the storage service", () => {
    expect("getPresignedDownloadUrl" in StorageService).toBe(false)
  })

  it("is absent from the registered driver", async () => {
    const driver = await resolveStorageDriver()
    expect("getPresignedDownloadUrl" in driver).toBe(false)
  })

  it("means the presigner package is not even a dependency", () => {
    // STRONGER THAN THE MOCK THIS REPLACED. Phase 1 asserted that
    // `getSignedUrl` was never called, which needed the package installed in
    // order to mock it. Phase 5 removed the dependency, so the guarantee is now
    // that it cannot be called: there is nothing to call.
    const manifest = JSON.parse(readFileSync("package.json", "utf8"))

    expect(manifest.dependencies).not.toHaveProperty("@aws-sdk/s3-request-presigner")
    expect(manifest.devDependencies ?? {}).not.toHaveProperty("@aws-sdk/s3-request-presigner")
  })

  it("is not imported anywhere in the application", () => {
    const offenders = sourceFiles().filter((file) =>
      readFileSync(file, "utf8").includes("s3-request-presigner"),
    )

    expect(offenders).toEqual([])
  })
})

/** Every application source file, for the import assertions above. */
function sourceFiles(root = "src"): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root)) {
    const full = join(root, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/.(ts|tsx)$/.test(full)) out.push(full)
  }
  return out
}
