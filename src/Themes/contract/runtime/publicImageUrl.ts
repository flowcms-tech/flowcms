/**
 * The PUBLIC access path for stored images.
 *
 * Anything a crawler must fetch — OG tags, JSON-LD `image`, `<img src>` on a
 * public page — goes through here. This route is anonymous and authorises a key
 * only because published content refers to it.
 *
 * Admin surfaces use `/api/media` instead, which requires a session and can
 * serve an object nothing has published yet.
 *
 * Both used to compete with a third path, `getPresignedDownloadUrl`, which
 * handed the browser a signed URL pointing at the object store. Phase 2 deleted
 * it: the signature expired within the hour (breaking exactly the crawler case
 * this file exists for), and on the bundled-Garage deployment the URL named an
 * internal Docker hostname the browser could not resolve at all.
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
