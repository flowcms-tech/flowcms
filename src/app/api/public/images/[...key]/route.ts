import { NextResponse } from "next/server"
import { StorageService } from "@/Framework/Storage/StorageService"
import { getFileCategory, getFileExtension } from "@/Framework/Functions/FileValidation"
import { isPubliclyReferencedImage } from "@/Framework/Storage/publicImageAccess"

/**
 * Unauthenticated image reads for the public site.
 *
 * This is the only route in the app that reads storage with no session, so the
 * key is treated as hostile input. Three guards, and every rejection returns 404
 * rather than 403 — a 403 would confirm that a key exists.
 *
 * The authorization rule itself lives in
 * `@/Framework/Storage/publicImageAccess`, extracted so it can be unit-tested
 * directly: a Next route module may only export HTTP method handlers, so the
 * rule was otherwise only reachable by fabricating requests.
 *
 * NOT TO BE CONFUSED WITH `/api/media/[...key]`, which Phase 2 added. That one
 * requires a session and serves any object, for admin surfaces. This one is
 * anonymous and serves only images that published content refers to. The two
 * must never be merged, and this one must never be widened to make an admin
 * screen convenient.
 */

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
}

function isSafeKey(key: string): boolean {
  if (!key) return false
  if (key.includes("\\") || key.includes("\0")) return false
  if (key.startsWith("/")) return false
  return key.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  // params is async in Next 16
  const { key } = await params
  const objectKey = key.map(decodeURIComponent).join("/")

  const notFound = () => NextResponse.json({ message: "Not found" }, { status: 404 })

  if (!isSafeKey(objectKey)) return notFound()
  if (getFileCategory(objectKey) !== "image") return notFound()
  if (!(await isPubliclyReferencedImage(objectKey))) return notFound()

  let body: Buffer
  try {
    body = await StorageService.downloadObject(objectKey)
  } catch {
    return notFound()
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": CONTENT_TYPES[getFileExtension(objectKey)] ?? "application/octet-stream",
      // DEFENCE IN DEPTH, matching the private media route.
      //
      // Two checks above already make the fallback branch unreachable: the key
      // must have an image category, and every image extension has an entry in
      // CONTENT_TYPES. But this response is ANONYMOUS and served from the
      // public origin, so the cost of being wrong is stored XSS on the site
      // itself — and the header costs a browser nothing. Without it, a
      // response that ever did fall through to octet-stream could be sniffed as
      // markup and rendered.
      "X-Content-Type-Options": "nosniff",
      // Safe because the File Manager names uploads uniquely rather than
      // overwriting in place. Revisit if keys ever become mutable.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
}
