import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * THE FEATURE THE WHOLE REFACTOR EXISTS FOR, AT THE API LEVEL.
 *
 * Every earlier phase tested the drivers. That proves a `StorageDriver` behaves
 * the same on both backends and says nothing about whether the FILE MANAGER
 * does — and the File Manager is what an operator actually uses. Its routes
 * build keys, validate types, serialise thumbnails, dispatch through
 * `StorageService` and record activity, none of which a driver test exercises.
 *
 * So these drive the REAL route handlers against a REAL filesystem store. Only
 * three things are stubbed, and none of them is storage:
 *
 *   the auth gate      the routes are admin-facing; a session is not what is
 *                      under test here, and `authorizationMatrix.test.ts`
 *                      already pins who may reach them
 *   the settings row   supplies the active-storage snapshot, standing in for a
 *                      database
 *   the activity log   writes to a database that does not exist here
 *
 * The S3 half of this matrix is covered against real Garage in the Docker
 * end-to-end run, because a mocked SDK would prove nothing about a provider.
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

// A cutover is not in progress; the gate is exercised by its own suite.
vi.mock("@/Framework/Storage/storageWriteLock", () => ({
  assertStorageWritable: async () => {},
  checkStorageWriteVerdict: async () => "writable",
  isStorageWriteLocked: async () => false,
  acquireCutoverLock: async () => false,
  StorageWriteLockedError: class extends Error {},
}))

const fileManager = await import("@/app/api/file-manager/route")
const directory = await import("@/app/api/file-manager/directory/route")
const file = await import("@/app/api/file-manager/file/route")
const directoryCopy = await import("@/app/api/file-manager/directory/copy/route")
const directoryMove = await import("@/app/api/file-manager/directory/move/route")
const fileCopy = await import("@/app/api/file-manager/file/copy/route")
const fileMove = await import("@/app/api/file-manager/file/move/route")
const { StorageService } = await import("@/Framework/Storage/StorageService")

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-filemanager-"))
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

// ---------------------------------------------------------------------------

function get(url: string) {
  return new NextRequest(`http://localhost${url}`, { method: "GET" })
}

function json(url: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

function upload(name: string, contents: string, prefix = "", type = "image/png") {
  const form = new FormData()
  form.set("file", new File([contents], name, { type }))
  form.set("prefix", prefix)
  return new NextRequest("http://localhost/api/file-manager", { method: "POST", body: form })
}

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T
}

// ---------------------------------------------------------------------------

describe("uploading and listing", () => {
  it("uploads a file and lists it back", async () => {
    const uploaded = await fileManager.POST(upload("photo.png", "pixels"))
    expect(uploaded.status).toBe(200)

    const listing = await body<{ data: { files: { name: string }[] } }>(
      await fileManager.GET(get("/api/file-manager?prefix=")),
    )

    expect(listing.data.files.map((f) => f.name)).toContain("photo.png")
  })

  it("gives an image a thumbnail URL through the application, never the store", async () => {
    // The URL used to be presigned and pointed straight at the object store —
    // a hostname only reachable inside the Docker network on bundled Garage,
    // and meaningless for a filesystem backend.
    await fileManager.POST(upload("photo.png", "pixels"))

    const listing = await body<{
      data: { files: { name: string; thumbnailUrl?: string }[] }
    }>(await fileManager.GET(get("/api/file-manager?prefix=")))

    const image = listing.data.files.find((f) => f.name === "photo.png")
    expect(image?.thumbnailUrl).toMatch(/^\/api\/media\//)
    expect(image?.thumbnailUrl).not.toMatch(/X-Amz|https?:\/\//)
  })

  it("leaks no bucket, endpoint or absolute path in a listing", async () => {
    await fileManager.POST(upload("photo.png", "pixels"))

    const raw = JSON.stringify(
      await body(await fileManager.GET(get("/api/file-manager?prefix="))),
    )

    expect(raw).not.toContain(root)
    expect(raw).not.toMatch(/bucket|endpoint|s3\./i)
  })

  it("stores a file with a Unicode name", async () => {
    const uploaded = await fileManager.POST(upload("Ünïcødé-фото-写真.png", "pixels"))
    expect(uploaded.status).toBe(200)

    const listing = await body<{ data: { files: { name: string }[] } }>(
      await fileManager.GET(get("/api/file-manager?prefix=")),
    )
    expect(listing.data.files).toHaveLength(1)
    // Whatever the key became, it round-trips through the store.
    const stored = listing.data.files[0].name
    expect(await StorageService.downloadObject(stored)).toBeTruthy()
  })

  it("SANITISES a traversal attempt in the submitted filename", async () => {
    // `file.name` comes from the multipart body, so a non-browser client can
    // put anything in it. The key is built rather than concatenated, so the
    // upload succeeds with a SAFE key rather than being refused — what matters
    // is that nothing lands outside the store.
    const response = await fileManager.POST(upload("../../etc/passwd.png", "x"))
    expect(response.status).toBe(200)

    const listing = await body<{ data: { files: { id: string }[] } }>(
      await fileManager.GET(get("/api/file-manager?prefix=")),
    )

    for (const stored of listing.data.files) {
      expect(stored.id).not.toContain("..")
      expect(stored.id.startsWith("/") || stored.id.startsWith("\\")).toBe(false)
    }
    // And nothing escaped onto the real filesystem.
    expect(existsSync(join(root, "..", "..", "etc"))).toBe(false)
  })

  it("refuses a file type that is not allowed", async () => {
    const response = await fileManager.POST(upload("payload.exe", "MZ", "", "application/exe"))

    expect(response.status).toBe(422)
  })

  it("lists more than a thousand objects", async () => {
    // The old S3 listing stopped at one page. A folder is not a page.
    for (let i = 0; i < 1050; i += 1) {
      await StorageService.uploadObject(`bulk/f-${String(i).padStart(5, "0")}.png`, Buffer.from("x"))
    }

    const listing = await body<{ data: { files: unknown[] } }>(
      await fileManager.GET(get("/api/file-manager?prefix=bulk/")),
    )

    expect(listing.data.files).toHaveLength(1050)
  }, 60_000)
})

describe("folders", () => {
  it("creates an empty folder and lists it", async () => {
    const created = await directory.POST(
      json("/api/file-manager/directory", "POST", { prefix: "", name: "album" }),
    )
    expect(created.status).toBe(200)

    const listing = await body<{ data: { directories: string[] } }>(
      await fileManager.GET(get("/api/file-manager?prefix=")),
    )
    expect(listing.data.directories).toContain("album/")
  })

  it("renames a folder and its contents move with it", async () => {
    await StorageService.uploadObject("album/inside.png", Buffer.from("x"))

    const renamed = await directory.PATCH(
      json("/api/file-manager/directory", "PATCH", { prefix: "album/", name: "gallery" }),
    )
    expect(renamed.status).toBe(200)

    expect((await StorageService.downloadObject("gallery/inside.png")).toString()).toBe("x")
    await expect(StorageService.downloadObject("album/inside.png")).rejects.toThrow()
  })

  it("copies a folder, leaving the original", async () => {
    await StorageService.uploadObject("album/inside.png", Buffer.from("x"))

    const copied = await directoryCopy.POST(
      json("/api/file-manager/directory/copy", "POST", {
        prefix: "album/",
        destination: "backup/",
      }),
    )
    expect(copied.status).toBe(200)

    expect((await StorageService.downloadObject("backup/album/inside.png")).toString()).toBe("x")
    expect((await StorageService.downloadObject("album/inside.png")).toString()).toBe("x")
  })

  it("moves a folder", async () => {
    await StorageService.uploadObject("album/inside.png", Buffer.from("x"))

    const moved = await directoryMove.POST(
      json("/api/file-manager/directory/move", "POST", {
        prefix: "album/",
        destination: "archive/",
      }),
    )
    expect(moved.status).toBe(200)

    expect((await StorageService.downloadObject("archive/album/inside.png")).toString()).toBe("x")
    await expect(StorageService.downloadObject("album/inside.png")).rejects.toThrow()
  })

  it("deletes a folder and everything under it", async () => {
    await StorageService.uploadObject("album/inside.png", Buffer.from("x"))

    const deleted = await directory.DELETE(
      json("/api/file-manager/directory", "DELETE", { prefix: "album/" }),
    )
    expect(deleted.status).toBe(200)

    await expect(StorageService.downloadObject("album/inside.png")).rejects.toThrow()
  })
})

describe("files", () => {
  it("renames a file", async () => {
    await StorageService.uploadObject("a.png", Buffer.from("x"))

    const renamed = await file.PATCH(
      json("/api/file-manager/file", "PATCH", { key: "a.png", name: "b.png" }),
    )
    expect(renamed.status).toBe(200)

    expect((await StorageService.downloadObject("b.png")).toString()).toBe("x")
    await expect(StorageService.downloadObject("a.png")).rejects.toThrow()
  })

  it("copies a file, leaving the original", async () => {
    await StorageService.uploadObject("a.png", Buffer.from("x"))

    const copied = await fileCopy.POST(
      json("/api/file-manager/file/copy", "POST", {
        key: "a.png",
        destination: "copies/",
      }),
    )
    expect(copied.status).toBe(200)

    expect((await StorageService.downloadObject("copies/a.png")).toString()).toBe("x")
    expect((await StorageService.downloadObject("a.png")).toString()).toBe("x")
  })

  it("moves a file", async () => {
    await StorageService.uploadObject("a.png", Buffer.from("x"))

    const moved = await fileMove.POST(
      json("/api/file-manager/file/move", "POST", {
        key: "a.png",
        destination: "moved/",
      }),
    )
    expect(moved.status).toBe(200)

    expect((await StorageService.downloadObject("moved/a.png")).toString()).toBe("x")
    await expect(StorageService.downloadObject("a.png")).rejects.toThrow()
  })

  it("deletes a file", async () => {
    await StorageService.uploadObject("a.png", Buffer.from("x"))

    const deleted = await file.DELETE(
      json("/api/file-manager/file", "DELETE", { key: "a.png" }),
    )
    expect(deleted.status).toBe(200)

    await expect(StorageService.downloadObject("a.png")).rejects.toThrow()
  })
})
