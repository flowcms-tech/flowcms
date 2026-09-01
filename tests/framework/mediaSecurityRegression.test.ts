import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * THE TWO MEDIA ROUTES, RE-AUDITED AFTER THE REFACTOR.
 *
 *   /api/media/[...key]           authenticated. Serves ANY stored object to a
 *                                 signed-in user, so its job is to make sure
 *                                 nothing it hands back can execute in the
 *                                 admin's own origin.
 *
 *   /api/public/images/[...key]   anonymous. Serves only images that PUBLISHED
 *                                 content refers to, so its job is to make sure
 *                                 a reference check happens before any byte is
 *                                 read.
 *
 * The refactor's claim is that swapping the backend changes none of this. That
 * is not obvious — both routes used to hand the browser a presigned URL, which
 * moved the authorization decision to a signature the object store checked. Now
 * the bytes come through the application, and the rules live here.
 *
 * Driven against a REAL filesystem store, through the real handlers.
 */

let workspace: string
let root: string

vi.mock("@/db/activityLog", () => ({ recordActivity: async () => {} }))

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

const authenticated = vi.fn()
vi.mock("@/Framework/Auth/apiAuth", () => ({
  requireApiAuth: () => authenticated(),
}))

const publiclyReferenced = vi.fn()
vi.mock("@/Framework/Storage/publicImageAccess", () => ({
  isPubliclyReferencedImage: (key: string) => publiclyReferenced(key),
}))

const media = await import("@/app/api/media/[...key]/route")
const publicImages = await import("@/app/api/public/images/[...key]/route")
const { StorageService } = await import("@/Framework/Storage/StorageService")

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-media-sec-"))
})

afterAll(() => {
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // Windows holds handles briefly.
  }
})

beforeEach(() => {
  // Call history matters here: several assertions are that a check ran BEFORE
  // any byte was read, which is meaningless if counts carry over.
  authenticated.mockReset()
  publiclyReferenced.mockReset()
  settingsRow.mockReset()

  root = mkdtempSync(join(workspace, "store-"))
  settingsRow.mockResolvedValue({
    setupCompletedAt: new Date(),
    activeStorageDriver: "local",
    activeStorageRoot: root,
  })
  authenticated.mockResolvedValue({
    ok: true,
    session: { user: { id: "u1", role: "admin" } },
    userId: "u1",
    role: "admin",
  })
  publiclyReferenced.mockResolvedValue(true)
})

const params = (key: string[]) => ({ params: Promise.resolve({ key }) })
const request = (url: string) => new NextRequest(`http://localhost${url}`)

describe("private media requires a session", () => {
  it("refuses when the gate refuses, before touching storage", async () => {
    const refusal = new Response(null, { status: 401 })
    authenticated.mockResolvedValue({ ok: false, response: refusal })
    const read = vi.spyOn(StorageService, "downloadObject")

    const response = await media.GET(request("/api/media/a.png"), params(["a.png"]))

    expect(response.status).toBe(401)
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()
  })

  it("serves the bytes to a signed-in caller", async () => {
    await StorageService.uploadObject("a.png", Buffer.from("pixels"))

    const response = await media.GET(request("/api/media/a.png"), params(["a.png"]))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("pixels")
  })

  it("never lets a shared cache keep it", async () => {
    // The response depends on a session. A shared cache holding it is how one
    // admin's media reaches somebody else.
    await StorageService.uploadObject("a.png", Buffer.from("x"))

    const response = await media.GET(request("/api/media/a.png"), params(["a.png"]))

    expect(response.headers.get("Cache-Control")).toMatch(/private/)
    expect(response.headers.get("Cache-Control")).not.toMatch(/public/)
  })
})

describe("nothing served to the admin origin can execute in it", () => {
  it("always sets nosniff", async () => {
    await StorageService.uploadObject("a.png", Buffer.from("x"))

    const response = await media.GET(request("/api/media/a.png"), params(["a.png"]))

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })

  it.each([
    ["evil.html", "<script>alert(1)</script>"],
    ["evil.xhtml", "<html><body>x</body></html>"],
  ])("hands %s over as a download, never inline", async (name, contents) => {
    // These are not uploadable through the File Manager — the allowlist has no
    // entry for them — but an object store can hold anything, including files
    // that predate the allowlist or were put there by another tool.
    await StorageService.uploadObject(name, Buffer.from(contents))

    const response = await media.GET(request(`/api/media/${name}`), params([name]))

    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment/)
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream")
    expect(response.headers.get("Content-Type")).not.toMatch(/html/)
  })

  it("serves a scripted SVG inline, but under a policy that cannot run it", async () => {
    // SVG LEFT THE LIST ABOVE, THE GUARANTEE DID NOT. It became uploadable so
    // that logos and icons can be stored and displayed, which an attachment
    // disposition made impossible.
    //
    // The file below is the real attack: a picture carrying a script. In an
    // <img> — the only way a theme renders one — no browser runs it. The case
    // that mattered was a person opening the URL, where it becomes a document
    // on the admin's own origin, and that is what this policy shuts down:
    // `sandbox` without `allow-scripts` puts the response in an opaque origin,
    // and `default-src 'none'` refuses every script and outbound fetch.
    await StorageService.uploadObject(
      "evil-inline.svg",
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")
    )

    const response = await media.GET(
      request("/api/media/evil-inline.svg"),
      params(["evil-inline.svg"])
    )

    expect(response.headers.get("Content-Type")).toBe("image/svg+xml")

    const csp = response.headers.get("Content-Security-Policy") ?? ""
    expect(csp, "an SVG served without a CSP is stored XSS on the admin origin").toContain(
      "default-src 'none'"
    )
    expect(csp).toContain("sandbox")
    expect(csp).not.toContain("allow-scripts")
    // nosniff still matters: it stops a browser second-guessing the type.
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })

  it("serves a real image inline, because that is the point of the route", async () => {
    await StorageService.uploadObject("a.png", Buffer.from("x"))

    const response = await media.GET(request("/api/media/a.png"), params(["a.png"]))

    expect(response.headers.get("Content-Disposition")).toMatch(/^inline/)
    expect(response.headers.get("Content-Type")).toBe("image/png")
  })

  it("forces a download when asked, even for an inline type", async () => {
    await StorageService.uploadObject("a.png", Buffer.from("x"))

    const response = await media.GET(
      request("/api/media/a.png?download=1"),
      params(["a.png"]),
    )

    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment/)
  })
})

describe("public images are gated on a real reference", () => {
  it("serves an image published content points at", async () => {
    await StorageService.uploadObject("2026/08/a.png", Buffer.from("pixels"))

    const response = await publicImages.GET(
      request("/api/public/images/2026/08/a.png"),
      params(["2026", "08", "a.png"]),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("pixels")
  })

  it("serves a referenced SVG under a policy that cannot run it", async () => {
    // The same guarantee as on the admin route, and it matters MORE here: this
    // response is anonymous and comes from the site's own origin, so an SVG
    // able to run scripts would be stored XSS against every visitor rather than
    // against one signed-in admin.
    //
    // Reaching this point already required a published post or page to
    // reference the file — an attacker cannot serve an arbitrary SVG from here
    // — but a referenced image is exactly what a contributor can control.
    await StorageService.uploadObject(
      "2026/08/logo.svg",
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")
    )

    const response = await publicImages.GET(
      request("/api/public/images/2026/08/logo.svg"),
      params(["2026", "08", "logo.svg"]),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml")

    const csp = response.headers.get("Content-Security-Policy") ?? ""
    expect(csp, "an anonymous SVG without a CSP is stored XSS on the public site").toContain(
      "default-src 'none'"
    )
    expect(csp).toContain("sandbox")
    expect(csp).not.toContain("allow-scripts")
  })

  it("REFUSES an image nothing published refers to, without reading it", async () => {
    await StorageService.uploadObject("private/secret.png", Buffer.from("pixels"))
    publiclyReferenced.mockResolvedValue(false)
    const read = vi.spyOn(StorageService, "downloadObject")

    const response = await publicImages.GET(
      request("/api/public/images/private/secret.png"),
      params(["private", "secret.png"]),
    )

    expect(response.status).toBe(404)
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()
  })

  it("refuses anything that is not an image, whatever it is referenced by", async () => {
    // The reference check is not consulted: a non-image cannot be served here
    // even if published content somehow names it.
    await StorageService.uploadObject("doc.pdf", Buffer.from("%PDF"))

    const response = await publicImages.GET(
      request("/api/public/images/doc.pdf"),
      params(["doc.pdf"]),
    )

    expect(response.status).toBe(404)
    expect(publiclyReferenced).not.toHaveBeenCalled()
  })

  it("refuses a key that is not safe, before any check runs", async () => {
    for (const key of [["..", "etc", "passwd.png"], ["", "a.png"], [".", "a.png"]]) {
      const response = await publicImages.GET(
        request("/api/public/images/x"),
        params(key),
      )
      expect(response.status).toBe(404)
    }
    expect(publiclyReferenced).not.toHaveBeenCalled()
  })

  it("sets nosniff, because this response is anonymous and same-origin", async () => {
    await StorageService.uploadObject("a.png", Buffer.from("x"))

    const response = await publicImages.GET(
      request("/api/public/images/a.png"),
      params(["a.png"]),
    )

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })

  it("answers 404 rather than 503 when the object is gone", async () => {
    // The public route must not distinguish "absent" from "refused" for an
    // anonymous caller probing keys.
    const response = await publicImages.GET(
      request("/api/public/images/missing.png"),
      params(["missing.png"]),
    )

    expect(response.status).toBe(404)
  })
})

describe("the rules do not depend on which backend is active", () => {
  it("neither route knows what a driver is", () => {
    // Both go through `StorageService`. A route that branched on the backend
    // would be a place where the authorization rules could differ between them.
    const files = [
      "src/app/api/media/[...key]/route.ts",
      "src/app/api/public/images/[...key]/route.ts",
    ]
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")

      expect(code, `${file} references a driver`).not.toMatch(
        /S3StorageDriver|LocalStorageDriver|resolveStorageDriver|@aws-sdk/,
      )
      expect(code, `${file} branches on the driver`).not.toMatch(/driver\s*===/)
    }
  })
})
