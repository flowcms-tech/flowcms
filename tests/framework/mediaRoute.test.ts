import { beforeEach, describe, expect, it, vi } from "vitest"
import { mediaDownloadPath, mediaPath, MEDIA_ROUTE_BASE } from "@/Framework/Storage/mediaUrl"
import { StorageObjectNotFoundError, UnsafeStorageKeyError } from "@/Framework/Storage/StorageErrors"

/**
 * The provider-neutral delivery path.
 *
 * This route is what replaced presigned URLs, and the reason it had to is
 * concrete rather than architectural: on the default Docker deployment
 * `S3_ENDPOINT` is `http://garage:3900`, so every presigned URL FlowCMS handed
 * the browser named a host only reachable from inside the Docker network.
 * Verified against a running stack — the host resolver returns NXDOMAIN and
 * Garage publishes no ports — so admin thumbnails were already broken there.
 *
 * The route must therefore work for BOTH backends without knowing which one it
 * is talking to, which is exactly what the driver mock below asserts.
 */

const downloadObject = vi.fn()
vi.mock("@/Framework/Storage/StorageService", () => ({
  StorageService: { downloadObject: (key: string) => downloadObject(key) },
}))

const requireApiAuth = vi.fn()
vi.mock("@/Framework/Auth/apiAuth", () => ({
  requireApiAuth: (...a: unknown[]) => requireApiAuth(...a),
}))

const { GET } = await import("@/app/api/media/[...key]/route")

function request(path: string) {
  return new Request(`http://localhost:3000${path}`) as never
}

function params(...segments: string[]) {
  return { params: Promise.resolve({ key: segments }) }
}

beforeEach(() => {
  downloadObject.mockReset().mockResolvedValue(Buffer.from("bytes"))
  requireApiAuth.mockReset().mockResolvedValue({ ok: true, session: { user: { id: "u1" } } })
})

describe("url construction", () => {
  it("builds an origin-relative path under the media base", () => {
    expect(mediaPath("posts/a.png")).toBe(`${MEDIA_ROUTE_BASE}/posts/a.png`)
  })

  it("percent-encodes each segment but keeps the separators", () => {
    // Encoding the whole key would turn `/` into `%2F` and the route's
    // catch-all would then see one segment instead of two.
    expect(mediaPath("posts/a b&c.png")).toBe(`${MEDIA_ROUTE_BASE}/posts/a%20b%26c.png`)
  })

  it("round-trips a key with unicode and reserved characters", () => {
    const key = "posts/файл #1.png"
    const path = mediaPath(key)
    const decoded = path.slice(MEDIA_ROUTE_BASE.length + 1).split("/").map(decodeURIComponent).join("/")

    expect(decoded).toBe(key)
  })

  it("marks a download request", () => {
    expect(mediaDownloadPath("a.png")).toBe(`${MEDIA_ROUTE_BASE}/a.png?download=1`)
  })
})

describe("authentication", () => {
  it("refuses when the auth gate refuses", async () => {
    const denied = new Response("no", { status: 401 })
    requireApiAuth.mockResolvedValue({ ok: false, response: denied })

    expect(await GET(request("/api/media/a.png"), params("a.png"))).toBe(denied)
    // The gate must run BEFORE any storage read, or an unauthenticated request
    // still costs a bucket round trip and can be used to probe for keys.
    expect(downloadObject).not.toHaveBeenCalled()
  })
})

describe("serving bytes", () => {
  it("returns the object a driver produced, whichever driver that is", async () => {
    downloadObject.mockResolvedValue(Buffer.from([1, 2, 3]))

    const response = await GET(request("/api/media/posts/a.png"), params("posts", "a.png"))

    expect(response.status).toBe(200)
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3])
    // The route asks for a logical KEY. It never sees a bucket, an endpoint or
    // a filesystem path, which is what makes it provider-neutral.
    expect(downloadObject).toHaveBeenCalledWith("posts/a.png")
  })

  it("rejoins a nested key from the catch-all segments", async () => {
    await GET(request("/api/media/a/b/c.png"), params("a", "b", "c.png"))

    expect(downloadObject).toHaveBeenCalledWith("a/b/c.png")
  })

  it("decodes each segment", async () => {
    await GET(request("/api/media/posts/a%20b.png"), params("posts", "a%20b.png"))

    expect(downloadObject).toHaveBeenCalledWith("posts/a b.png")
  })

  it.each([
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["gif", "image/gif"],
    ["webp", "image/webp"],
    ["mp4", "video/mp4"],
  ])("serves .%s inline as %s", async (extension, type) => {
    const response = await GET(request(`/api/media/a.${extension}`), params(`a.${extension}`))

    expect(response.headers.get("Content-Type")).toBe(type)
    expect(response.headers.get("Content-Disposition")).toContain("inline")
  })

  it("never caches in a shared cache", async () => {
    const response = await GET(request("/api/media/a.png"), params("a.png"))

    // The response depends on a session. A shared cache keeping it is how one
    // admin's media reaches an unrelated visitor.
    expect(response.headers.get("Cache-Control")).toMatch(/^private,/)
  })
})

describe("content types that must never render inline", () => {
  it.each(["html", "svg", "xml", "js", "pdf", "txt", "unknown"])(
    "hands over .%s as an attachment with a generic type",
    async (extension) => {
      const response = await GET(request(`/api/media/x.${extension}`), params(`x.${extension}`))

      // Serving attacker-influenced bytes as text/html or image/svg+xml from the
      // admin's own origin is stored XSS with a session attached. The upload
      // allowlist refuses .html and .svg, but a bucket can hold keys no upload
      // created — a shared bucket, or objects predating the allowlist.
      expect(response.headers.get("Content-Type")).toBe("application/octet-stream")
      expect(response.headers.get("Content-Disposition")).toContain("attachment")
    },
  )

  it("always sets nosniff, so a browser cannot decide the type itself", async () => {
    const response = await GET(request("/api/media/x.html"), params("x.html"))

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })

  it("forces an attachment when asked, even for an inline type", async () => {
    const response = await GET(request("/api/media/a.png?download=1"), params("a.png"))

    expect(response.headers.get("Content-Disposition")).toContain("attachment")
  })
})

describe("failures", () => {
  it("answers 404 for a missing object", async () => {
    downloadObject.mockRejectedValue(new StorageObjectNotFoundError("gone.png"))

    const response = await GET(request("/api/media/gone.png"), params("gone.png"))
    expect(response.status).toBe(404)
  })

  it("answers 404 when the driver refuses the key", async () => {
    downloadObject.mockRejectedValue(new UnsafeStorageKeyError("it escapes the root"))

    const response = await GET(request("/api/media/x.png"), params("x.png"))
    expect(response.status).toBe(404)
  })

  it("answers 503, not 404, when storage itself is broken", async () => {
    // A backend outage reported as "not found" sends an operator hunting for a
    // file that is sitting right there.
    downloadObject.mockRejectedValue(new Error("connection refused"))

    const response = await GET(request("/api/media/a.png"), params("a.png"))
    expect(response.status).toBe(503)
  })

  it.each([
    { label: "parent traversal", segments: ["..", "secret.txt"] },
    { label: "empty segment", segments: ["", "a.png"] },
    { label: "dot segment", segments: [".", "a.png"] },
    { label: "null byte", segments: ["a\u0000.png"] },
    { label: "backslash", segments: ["..\\secret.txt"] },
  ])("refuses $label without touching storage", async ({ segments }) => {
    const response = await GET(request("/api/media/x"), params(...segments))

    expect(response.status).toBe(404)
    // Defence in depth: the local driver would refuse these anyway, but a
    // structurally impossible key should never reach a backend at all.
    expect(downloadObject).not.toHaveBeenCalled()
  })
})
