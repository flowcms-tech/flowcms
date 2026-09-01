import { NextRequest, NextResponse } from "next/server"
import { StorageService } from "@/Framework/Storage/StorageService"
import { StorageObjectNotFoundError, UnsafeStorageKeyError } from "@/Framework/Storage/StorageErrors"
import { getFileCategory, getFileExtension } from "@/Framework/Functions/FileValidation"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Authenticated reads of stored objects, for admin surfaces.
 *
 * THE POINT OF THIS ROUTE is that the browser stops talking to the object store.
 * Admin screens used to render presigned URLs, which meant the browser had to
 * reach the bucket itself — impossible on the default Docker deployment, where
 * `S3_ENDPOINT` is the internal hostname `http://garage:3900`, and meaningless
 * for a filesystem backend that has nothing to sign. Now every admin read is
 *
 *     browser -> this route -> StorageService -> whichever driver is active
 *
 * and the browser knows nothing about buckets, endpoints, credentials or paths.
 *
 * HOW THIS DIFFERS FROM `/api/public/images/[...key]`, which is NOT replaced and
 * NOT relaxed: that route is anonymous and answers only for keys a PUBLISHED
 * post or page refers to. This one requires a session and will serve any object
 * — which is correct, because the File Manager already lists them all to the
 * same person, and a contributor picking a featured image has to be able to see
 * files nothing references yet.
 */

/** Long enough to spare a folder of thumbnails a re-fetch on every re-render,
 *  short enough that replacing a file shows up promptly. */
const CACHE_SECONDS = 60

/**
 * Types served INLINE, and nothing else is.
 *
 * An allowlist rather than a lookup with a permissive fallback, because this
 * route returns attacker-influenced bytes from the same origin as the admin
 * panel. `text/html` served inline from here would be stored XSS with a session
 * attached, and a bucket can hold keys that no upload created — an S3 bucket
 * shared with another tool, or objects predating the allowlist — so this route
 * does not rely on the upload allowlist to keep those out.
 *
 * `svg` IS ON THIS LIST AND IS THE ONE ENTRY THAT IS NOT INERT. It renders as a
 * picture in an `<img>`, where no browser will run its scripts, but a URL opened
 * directly is a top-level document where they do. It is served under
 * `SVG_CSP` below, without which listing it here would be exactly the stored
 * XSS this allowlist exists to prevent.
 */
const INLINE_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
}

/**
 * Strips an SVG of everything that makes it a program.
 *
 * `sandbox` (with no `allow-scripts`) drops the response into an opaque origin,
 * and `default-src 'none'` refuses scripts and every outbound fetch. Inline
 * styles stay allowed because ordinary illustrations rely on them. None of this
 * affects an `<img>`, which already refused to run scripts — it closes the case
 * where the file is opened as a page.
 */
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"

/**
 * Rejects keys that are structurally wrong before they reach a driver.
 *
 * DEFENCE IN DEPTH, NOT THE DEFENCE. `LocalStorageDriver` enforces containment
 * itself and would refuse these anyway — that is where the security boundary
 * lives, because the other File Manager routes do no validation at all. This is
 * here so an obviously bad request is a cheap 404 rather than a driver
 * exception.
 */
function isStructurallySafe(key: string): boolean {
  if (!key) return false
  if (key.includes("\\") || key.includes("\u0000")) return false
  if (key.startsWith("/")) return false
  return key.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  // params is async in Next 16.
  const { key } = await params
  const objectKey = key.map(decodeURIComponent).join("/")

  const notFound = () => NextResponse.json({ message: "Not found" }, { status: 404 })

  if (!isStructurallySafe(objectKey)) return notFound()

  let body: Buffer
  try {
    body = await StorageService.downloadObject(objectKey)
  } catch (error) {
    // A missing object and an unsafe key are both 404: the caller is
    // authenticated, but there is still no reason to help them distinguish
    // "absent" from "refused" by probing.
    if (error instanceof StorageObjectNotFoundError || error instanceof UnsafeStorageKeyError) {
      return notFound()
    }
    // Anything else is the backend failing, which is not the caller's fault and
    // must not be reported as though the file did not exist.
    console.error("[flowcms:media] read failed", error)
    return NextResponse.json({ message: "Storage is unavailable" }, { status: 503 })
  }

  const extension = getFileExtension(objectKey)
  const inlineType = INLINE_CONTENT_TYPES[extension]
  const wantsDownload = new URL(request.url).searchParams.get("download") === "1"

  // Anything without an explicitly safe inline type is handed over as an
  // attachment with a generic type. It still downloads; it just cannot execute
  // in the admin's origin.
  const disposition = wantsDownload || !inlineType ? "attachment" : "inline"
  const contentType = disposition === "attachment" && !inlineType
    ? "application/octet-stream"
    : (inlineType ?? "application/octet-stream")

  const filename = objectKey.split("/").pop() || "file"

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.length),
      // `nosniff` matters most for the octet-stream branch: without it a
      // browser may sniff the bytes, decide the response is HTML, and render it.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(filename)}"`,
      // PRIVATE. This response depends on a session, so a shared cache must
      // never keep it — that is how one admin's media reaches another visitor.
      "Cache-Control": `private, max-age=${CACHE_SECONDS}`,
      // A category header costs nothing and saves the File Manager from
      // re-deriving it from the extension on the client.
      "X-Flowcms-File-Category": getFileCategory(objectKey),
      // Keyed on the extension, not the disposition: an SVG handed over as an
      // attachment is still an SVG the browser may later be pointed at.
      ...(extension === "svg" ? { "Content-Security-Policy": SVG_CSP } : {}),
    },
  })
}
