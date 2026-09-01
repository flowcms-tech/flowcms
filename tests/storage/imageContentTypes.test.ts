import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { ALLOWED_FILE_EXTENSIONS, getFileCategory } from "@/Framework/Functions/FileValidation"

/**
 * Both media routes claim an invariant in their own comments: every extension
 * the uploader accepts as an IMAGE has an entry in that route's content-type
 * map, which is what makes their `application/octet-stream` fallback
 * unreachable.
 *
 * Nothing enforced it. Adding `avif` and `svg` to the upload allowlist without
 * touching the routes would have left both maps short, quietly re-enabling the
 * fallback branch and leaving the new formats undisplayable on the site.
 *
 * Read from source rather than imported because both maps are module-private
 * inside Next route files, which may only export HTTP handlers.
 */

const root = fileURLToPath(new URL("../..", import.meta.url))

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, `file://${root}`), "utf8")
}

function mappedExtensions(source: string, mapName: string): string[] {
  const body = source.split(`const ${mapName}: Record<string, string> = {`)[1]?.split("}")[0] ?? ""
  return [...body.matchAll(/^\s*([a-z0-9]+)\s*:/gm)].map((match) => match[1])
}

const ROUTES = [
  { path: "src/app/api/media/[...key]/route.ts", map: "INLINE_CONTENT_TYPES" },
  { path: "src/app/api/public/images/[...key]/route.ts", map: "CONTENT_TYPES" },
] as const

const imageExtensions = ALLOWED_FILE_EXTENSIONS.filter(
  (extension) => getFileCategory(`x.${extension}`) === "image"
)

describe("image content types", () => {
  it("the allowlist actually carries the new formats", () => {
    expect(imageExtensions).toContain("avif")
    expect(imageExtensions).toContain("svg")
  })

  it.each(ROUTES)("$path maps every allowed image extension", ({ path, map }) => {
    const mapped = mappedExtensions(read(path), map)
    const missing = imageExtensions.filter((extension) => !mapped.includes(extension))

    expect(
      missing,
      `${map} is missing ${missing.join(", ")}. An image extension the uploader accepts but ` +
        `this route cannot type falls through to application/octet-stream and will not render.`
    ).toEqual([])
  })

  it.each(ROUTES)("$path neutralises SVG scripting", ({ path }) => {
    const source = read(path)

    // SVG is the one served type that is a document rather than a picture. In
    // an <img> a browser will not run it; opened as a URL it will. Without this
    // header that is stored XSS — on the admin origin for the private route,
    // and against every visitor for the public one.
    expect(source).toMatch(/Content-Security-Policy/)

    // Asserted against the POLICY VALUE, not the file. Scanning the whole
    // source also reads the comments explaining the policy, so a file saying
    // "no allow-scripts here" would fail a naive search for that word.
    const policies = [...source.matchAll(/"(default-src[^"]*)"/g)].map((match) => match[1])

    expect(policies.length, "no CSP value found to check").toBeGreaterThan(0)
    for (const policy of policies) {
      expect(policy).toContain("default-src 'none'")
      expect(policy).toContain("sandbox")
      expect(policy).not.toContain("allow-scripts")
    }
  })
})
