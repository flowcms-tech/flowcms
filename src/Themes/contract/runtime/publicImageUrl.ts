/**
 * The second access path for stored images, alongside
 * `StorageService.getPresignedDownloadUrl`.
 *
 * Presigned URLs expire (~1 h). Googlebot, Google Images, and the
 * Facebook/LinkedIn/X scrapers revisit days or weeks later, by which time the
 * signature is dead — so anything a crawler must fetch (OG tags, JSON-LD
 * `image`, `<img src>` on a public page) has to go through here instead.
 *
 * Admin surfaces (File Manager, post edit form) keep using presigned URLs.
 */
export const PUBLIC_IMAGE_ROUTE_BASE = "/api/public/images"

/** Absolute, because OG tags and JSON-LD both reject relative URLs. */
export function publicImageUrl(key: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "")
  return `${base}${publicImagePath(key)}`
}

/**
 * Origin-relative form, for `<img src>` inside stored post content.
 *
 * Deliberately NOT absolute: the body is persisted, so baking an origin into
 * it means every image breaks the day the domain changes or when the same rows
 * are served from staging. OG tags and JSON-LD still need `publicImageUrl` —
 * crawlers reject relative URLs there — but an `<img>` in the document does
 * not.
 */
export function publicImagePath(key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/")
  return `${PUBLIC_IMAGE_ROUTE_BASE}/${encoded}`
}
