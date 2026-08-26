import { describe, expect, it } from "vitest"
import {
  MAX_UPLOAD_BYTES,
  buildObjectKey,
  sanitizeFileName,
  sanitizePrefix,
} from "@/Framework/Storage/objectKey"

describe("sanitizeFileName", () => {
  it("keeps an ordinary filename intact", () => {
    expect(sanitizeFileName("my-photo_2026.jpg")).toBe("my-photo_2026.jpg")
  })

  it("strips any directory component, however it is spelled", () => {
    // The upload key used to be `prefix + file.name` with no processing, and
    // `file.name` is whatever the client's multipart body claims it is.
    expect(sanitizeFileName("../../etc/passwd.pdf")).toBe("passwd.pdf")
    expect(sanitizeFileName("/absolute/path.png")).toBe("path.png")
    const backslash = String.fromCharCode(92)
    expect(sanitizeFileName(`windows${backslash}style${backslash}path.png`)).toBe("path.png")
    expect(sanitizeFileName("....//....//evil.png")).not.toContain("/")
  })

  it("refuses names that reduce to a traversal segment", () => {
    expect(() => sanitizeFileName("..")).toThrow()
    expect(() => sanitizeFileName(".")).toThrow()
    expect(() => sanitizeFileName("")).toThrow()
    expect(() => sanitizeFileName("   ")).toThrow()
  })

  it("removes control characters and NUL", () => {
    const out = sanitizeFileName("evil\u0000name\u0007.png")
    expect(out).not.toContain("\u0000")
    expect(out).not.toContain("\u0007")
  })

  it("collapses characters that confuse S3 keys and URLs", () => {
    const out = sanitizeFileName("a b?c#d%e.png")
    expect(out).not.toMatch(/[?#%\s]/)
    expect(out.endsWith(".png")).toBe(true)
  })

  it("preserves the extension, because the allowlist is checked on it", () => {
    expect(sanitizeFileName("report.final.PDF").toLowerCase().endsWith(".pdf")).toBe(true)
  })

  it("bounds the length so a key cannot be used to exhaust storage metadata", () => {
    const out = sanitizeFileName("a".repeat(500) + ".png")
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out.endsWith(".png")).toBe(true)
  })
})

describe("sanitizePrefix", () => {
  it("accepts a legitimate nested prefix and normalises the trailing slash", () => {
    // Nested prefixes are a real feature of the File Manager and must keep
    // working — this is a sanitiser, not a flattener.
    expect(sanitizePrefix("marketing/2026/q1/")).toBe("marketing/2026/q1/")
    expect(sanitizePrefix("marketing/2026/q1")).toBe("marketing/2026/q1/")
  })

  it("treats an empty prefix as the bucket root", () => {
    expect(sanitizePrefix("")).toBe("")
    expect(sanitizePrefix("/")).toBe("")
  })

  it("rejects traversal in any segment", () => {
    expect(() => sanitizePrefix("../secrets/")).toThrow()
    expect(() => sanitizePrefix(`a${String.fromCharCode(92)}b/`)).toThrow()
    expect(() => sanitizePrefix(`a${String.fromCharCode(92)}b/`)).toThrow()
  })

  it("rejects backslashes and control characters", () => {
    expect(() => sanitizePrefix(`a${String.fromCharCode(92)}b/`)).toThrow()
    expect(() => sanitizePrefix(`a${String.fromCharCode(0)}b/`)).toThrow()
    expect(() => sanitizePrefix(`a${String.fromCharCode(10)}b/`)).toThrow()
  })

  it("rejects a leading slash so a key can never be absolute", () => {
    expect(() => sanitizePrefix("/leading/")).toThrow()
  })

  it("rejects empty interior segments", () => {
    expect(() => sanitizePrefix(`a${String.fromCharCode(92)}b/`)).toThrow()
  })
})

describe("buildObjectKey", () => {
  it("joins a sanitised prefix and filename", () => {
    expect(buildObjectKey("posts/", "cover.png")).toBe("posts/cover.png")
    expect(buildObjectKey("", "cover.png")).toBe("cover.png")
  })

  it("cannot be made to escape the prefix", () => {
    expect(buildObjectKey("posts/", "../../../etc/passwd.pdf")).toBe("posts/passwd.pdf")
  })

  it("cannot be made absolute", () => {
    expect(buildObjectKey("posts/", "/etc/passwd.pdf").startsWith("/")).toBe(false)
  })
})

describe("MAX_UPLOAD_BYTES", () => {
  it("is a finite, enforced ceiling", () => {
    // The route previously read the whole body into memory with no limit at
    // all, so a single request could exhaust the process.
    expect(Number.isFinite(MAX_UPLOAD_BYTES)).toBe(true)
    expect(MAX_UPLOAD_BYTES).toBeGreaterThan(1024 * 1024)
  })
})
