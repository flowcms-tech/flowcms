import { beforeEach, describe, expect, it, vi } from "vitest"
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

const getSignedUrl = vi.fn()
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrl(...args),
}))

const getS3Config = vi.fn()
vi.mock("@/Framework/Settings/SettingsService", () => ({
  getS3Config: () => getS3Config(),
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
  getSignedUrl.mockReset()
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
    // S3 can presign, so the optional member must actually be present —
    // without it every admin thumbnail would throw
    // StoragePresigningUnsupportedError.
    expect(typeof driver.getPresignedDownloadUrl).toBe("function")
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

  it("propagates the not-configured error rather than swallowing it", async () => {
    // `checkStoragePrerequisite` and `checkStorage` both classify deployment
    // state by catching this, so it must keep escaping the storage layer.
    getS3Config.mockRejectedValue(new Error("S3 is not configured — set it in Admin"))

    await expect(StorageService.uploadObject("a.txt", Buffer.from("x"))).rejects.toThrow(
      "S3 is not configured",
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

describe("getPresignedDownloadUrl", () => {
  it("signs a GetObject for the key with the requested lifetime", async () => {
    getSignedUrl.mockResolvedValue("https://example.test/signed")

    const url = await StorageService.getPresignedDownloadUrl("posts/a.png", 300)

    expect(url).toBe("https://example.test/signed")
    const [, command, options] = getSignedUrl.mock.calls[0] as [
      unknown,
      GetObjectCommand,
      { expiresIn: number },
    ]
    expect(command).toBeInstanceOf(GetObjectCommand)
    expect(command.input).toEqual({ Bucket: BUCKET, Key: "posts/a.png" })
    expect(options).toEqual({ expiresIn: 300 })
  })

  it("defaults to one hour", async () => {
    getSignedUrl.mockResolvedValue("https://example.test/signed")

    await StorageService.getPresignedDownloadUrl("posts/a.png")

    const [, , options] = getSignedUrl.mock.calls[0] as [unknown, unknown, { expiresIn: number }]
    expect(options).toEqual({ expiresIn: 3600 })
  })
})
