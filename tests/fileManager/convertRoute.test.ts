import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * IMAGE CONVERSION, AND THE THREE THINGS IT MUST NEVER DO.
 *
 * The feature is safe for one structural reason: it only ever ADDS a file.
 * Converting changes the extension, so the result is a new key — and keys are
 * this app's foreign keys, held in eight columns and written into post bodies
 * as `<img src>`. A route that replaced the source would orphan every reference
 * to it, with the damage appearing on the published site rather than here.
 *
 * So the tests that matter are the refusals: never overwrite the source, never
 * overwrite a bystander, never decode something ruinous.
 */

let workspace: string
let root: string

vi.mock("@/Framework/Auth/apiAuth", () => ({
  requireApiAuth: async () => ({
    ok: true,
    session: { user: { id: "admin-1", role: "admin", name: "Admin", email: "a@example.com" } },
    userId: "admin-1",
    role: "admin",
  }),
}))

vi.mock("@/db/activityLog", () => ({
  recordActivity: async () => {},
  changedFieldLabels: () => ({}),
  summariseChanges: () => "",
}))

const settingsRow = vi.fn()
vi.mock("@/Framework/Settings/SettingsService", () => ({
  getSettingsRow: () => settingsRow(),
  getS3Config: () => Promise.reject(new Error("S3 is not configured")),
  invalidateSettingsCache: () => Promise.resolve(),
}))

vi.mock("@/Framework/Storage/storageWriteLock", () => ({
  assertStorageWritable: async () => {},
  checkStorageWriteVerdict: async () => "writable",
  isStorageWriteLocked: async () => false,
  acquireCutoverLock: async () => false,
  StorageWriteLockedError: class extends Error {},
}))

const convert = await import("@/app/api/file-manager/file/convert/route")
const { StorageService } = await import("@/Framework/Storage/StorageService")
const { createCanvas } = await import("@napi-rs/canvas")

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-convert-"))
})

afterAll(() => {
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // Windows holds handles briefly.
  }
})

beforeEach(() => {
  root = mkdtempSync(join(workspace, "store-"))
  settingsRow.mockResolvedValue({
    setupCompletedAt: new Date(),
    activeStorageDriver: "local",
    activeStorageRoot: root,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

function post(body: unknown) {
  return new NextRequest("http://localhost/api/file-manager/file/convert", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

/** A real PNG, because the route decodes what it is given. */
function png(width = 24, height = 24): Buffer {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext("2d")
  context.fillStyle = "rgba(220,20,90,0.5)"
  context.fillRect(0, 0, width, height)
  return canvas.toBuffer("image/png")
}

async function message(response: Response): Promise<string> {
  const parsed = (await response.json()) as { message: string | string[] }
  return Array.isArray(parsed.message) ? parsed.message.join(" ") : parsed.message
}

describe("converting an image", () => {
  it("writes a new file and leaves the original untouched", async () => {
    await StorageService.uploadObject("photos/a.png", png())

    const response = await convert.POST(
      post({ key: "photos/a.png", format: "webp", name: "a", destination: "photos/" })
    )

    expect(response.status).toBe(200)

    const listing = await StorageService.listDirectory("photos/")
    const names = listing.files.map((file) => file.key)
    expect(names).toContain("photos/a.webp")
    // THE POINT OF THE WHOLE DESIGN.
    expect(names).toContain("photos/a.png")
  })

  it("can write every format the encoder supports", async () => {
    await StorageService.uploadObject("a.png", png())

    for (const format of ["webp", "avif", "jpg", "png"]) {
      const response = await convert.POST(
        post({ key: "a.png", format, name: `out-${format}`, destination: "" })
      )
      expect(response.status, `${format} should convert`).toBe(200)
    }

    const listing = await StorageService.listDirectory("")
    const names = listing.files.map((file) => file.key)
    for (const extension of ["webp", "avif", "jpg", "png"]) {
      expect(names).toContain(`out-${extension}.${extension}`)
    }
  })

  it("converts into another folder when one is given", async () => {
    await StorageService.uploadObject("a.png", png())

    const response = await convert.POST(
      post({ key: "a.png", format: "webp", name: "a", destination: "archive/" })
    )

    expect(response.status).toBe(200)
    const listing = await StorageService.listDirectory("archive/")
    expect(listing.files.map((file) => file.key)).toContain("archive/a.webp")
  })
})

describe("what conversion refuses to destroy", () => {
  it("REFUSES to write over the source itself", async () => {
    // The case that looks like a no-op and is not: re-encoding a PNG as a PNG,
    // in its own folder, under its own name, resolves to the source's key.
    await StorageService.uploadObject("a.png", png())

    const response = await convert.POST(
      post({ key: "a.png", format: "png", name: "a", destination: "" })
    )

    expect(response.status).toBe(422)
    expect(await message(response)).toMatch(/overwrite the original/i)
  })

  it("REFUSES to write over an unrelated file that already holds the name", async () => {
    await StorageService.uploadObject("a.png", png())
    await StorageService.uploadObject("a.webp", Buffer.from("someone else's file"))

    const response = await convert.POST(
      post({ key: "a.png", format: "webp", name: "a", destination: "" })
    )

    expect(response.status).toBe(422)
    expect(await message(response)).toMatch(/already exists/i)

    // Untouched, byte for byte.
    const kept = await StorageService.downloadObject("a.webp")
    expect(kept.toString()).toBe("someone else's file")
  })

  it("refuses a file that is not an image", async () => {
    await StorageService.uploadObject("notes.pdf", Buffer.from("%PDF"))

    const response = await convert.POST(
      post({ key: "notes.pdf", format: "webp", name: "notes", destination: "" })
    )

    expect(response.status).toBe(422)
    expect(await message(response)).toMatch(/only images/i)
  })

  it("refuses an SVG with no intrinsic size rather than writing an empty file", async () => {
    // Verified against the decoder: no width/height and no viewBox reports 0x0,
    // which would otherwise be encoded as a zero-sized image.
    await StorageService.uploadObject(
      "sizeless.svg",
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>')
    )

    const response = await convert.POST(
      post({ key: "sizeless.svg", format: "png", name: "sizeless", destination: "" })
    )

    expect(response.status).toBe(422)
    expect(await message(response)).toMatch(/no intrinsic size/i)
  })

  it("refuses SVG, which cannot be produced from pixels", async () => {
    await StorageService.uploadObject("a.png", png())

    const response = await convert.POST(
      post({ key: "a.png", format: "svg", name: "a", destination: "" })
    )

    expect(response.status).toBe(422)
  })

  it("refuses GIF, which CAN be produced but is deliberately not offered", async () => {
    // The distinction matters to whoever reads this next. The encoder writes a
    // valid GIF89a — this is a product decision, not a capability gap. A single
    // frame at 256 colours is a worse result than any format that is offered,
    // so the route must not quietly accept it just because it could.
    await StorageService.uploadObject("a.png", png())

    const response = await convert.POST(
      post({ key: "a.png", format: "gif", name: "a", destination: "" })
    )

    expect(response.status).toBe(422)
    expect((await StorageService.listDirectory("")).files.map((f) => f.key)).not.toContain("a.gif")
  })

  it("refuses a traversing destination", async () => {
    await StorageService.uploadObject("a.png", png())

    const response = await convert.POST(
      post({ key: "a.png", format: "webp", name: "a", destination: "../escape/" })
    )

    expect(response.status).toBe(422)
  })
})

describe("transparency", () => {
  it("gives JPEG a white background instead of black, since it has no alpha", async () => {
    await StorageService.uploadObject("t.png", png())

    const response = await convert.POST(
      post({ key: "t.png", format: "jpg", name: "t", destination: "" })
    )

    expect(response.status).toBe(200)

    // A flattened-onto-nothing JPEG comes out near black. Sampling the decoded
    // result is the only way to tell that apart from a correct conversion.
    const { loadImage } = await import("@napi-rs/canvas")
    const image = await loadImage(await StorageService.downloadObject("t.jpg"))
    const probe = createCanvas(image.width, image.height)
    const context = probe.getContext("2d")
    context.drawImage(image, 0, 0)
    const [r, g, b] = context.getImageData(1, 1, 1, 1).data

    expect(r + g + b, "a black result means the alpha was flattened onto nothing").toBeGreaterThan(
      120
    )
  })
})
