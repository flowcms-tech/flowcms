/**
 * How an ADMIN surface addresses a stored object.
 *
 * The sibling of `publicImageUrl.ts`, and the two are deliberately separate:
 *
 *   /api/media/<key>          authenticated. Any object, for a signed-in user.
 *   /api/public/images/<key>  anonymous. Only keys a published post or page
 *                             refers to, and only images.
 *
 * WHAT THIS REPLACES. Admin surfaces used to render
 * `StorageService.getPresignedDownloadUrl(key)` — a URL pointing straight at
 * the object store, carrying an `X-Amz-Signature`, that the BROWSER fetched
 * directly. That had three problems, and the first is not theoretical:
 *
 *   1. On the default Docker deployment it does not work at all. Compose sets
 *      `S3_ENDPOINT=http://garage:3900`, an internal hostname on the Docker
 *      network, so every presigned URL handed to the browser names a host the
 *      browser cannot resolve. Verified against a running stack: the host gets
 *      NXDOMAIN, and Garage publishes no ports.
 *   2. It leaks the bucket name, the endpoint and the access key ID into
 *      page source, because all three are part of a presigned URL.
 *   3. It cannot survive a second backend. There is nothing to sign on a
 *      filesystem.
 *
 * Routing admin reads through the application fixes all three, and it is why
 * `getPresignedDownloadUrl` no longer exists anywhere in FlowCMS.
 */

export const MEDIA_ROUTE_BASE = "/api/media"

/**
 * Origin-relative, deliberately.
 *
 * Every consumer is an admin screen served from the same origin, so a relative
 * URL is what makes the session cookie accompany the request — and it keeps the
 * value correct when the same database is served from staging under a different
 * hostname.
 */
export function mediaPath(key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/")
  return `${MEDIA_ROUTE_BASE}/${encoded}`
}

/** The same object, asked for as a download rather than for display. */
export function mediaDownloadPath(key: string): string {
  return `${mediaPath(key)}?download=1`
}
