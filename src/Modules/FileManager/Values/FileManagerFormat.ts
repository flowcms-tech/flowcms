/**
 * Presentation helpers shared by the File Manager's list, grid and properties
 * dialog — the three places that render the same object three ways.
 */

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

/** `2.0 MB`. One decimal is enough to compare two files at a glance. */
export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${bytes} B`
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`
  return `${(bytes / GB).toFixed(1)} GB`
}

/**
 * `2,097,152 bytes` — the exact figure `formatBytes` rounds away.
 *
 * The locale is pinned rather than left to the browser: this sits beside the
 * rounded size as its precise counterpart, and a separator that changes with
 * the reader's machine makes the two look like different measurements.
 */
export function formatExactBytes(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} bytes`
}

/** The directory an object key sits in: `a/b/file.zip` -> `a/b/`, root -> ``. */
export function parentPrefixOf(key: string): string {
  return key.slice(0, key.lastIndexOf('/') + 1)
}
