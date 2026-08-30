import { promises as fs } from "node:fs"
import path from "node:path"
import { UnsafeStorageKeyError } from "./StorageErrors"

export { UnsafeStorageKeyError }

/**
 * Turning an object key into a filesystem path, safely.
 *
 * THIS MODULE IS A SECURITY CONTROL, NOT A PATH UTILITY.
 *
 * Under S3 an object key is an opaque string. `../../etc/passwd` names an
 * object, it does not reach a parent directory, and the File Manager can hand
 * the storage layer anything without consequence. That is exactly what it does:
 * of the nine File Manager routes, only `POST /api/file-manager` sanitises its
 * input (via `objectKey.ts`). The rest read `key`, `prefix` and `destination`
 * out of the request body and pass them straight down.
 *
 * So a filesystem backend cannot inherit its safety from the routes — they have
 * none to give. Containment is enforced here, at the single point where a key
 * becomes a path, and it fails closed.
 *
 * WHY THE S3 DRIVER IS NOT CHANGED TO MATCH. Existing deployments hold keys
 * that these rules would reject, and an S3 key containing `..` or a backslash
 * is harmless. Tightening the shared vocabulary to suit one backend would break
 * real objects in real buckets to fix a problem those buckets do not have. The
 * rule belongs where paths are built.
 */

const NULL_BYTE = "\u0000"

/** `C:` or `d:` at the head of a key — a Windows drive-relative path. */
const WINDOWS_DRIVE = /^[A-Za-z]:/

/**
 * Splits a key into segments, refusing anything that could leave the root.
 *
 * REJECTS RATHER THAN REPAIRS. Silently rewriting `../x` into `x` would tell
 * the caller their write went where they asked when it did not, and a caller
 * that believes a false location is how the wrong object gets deleted later.
 *
 * `..` is refused even when the traversal would land back inside the root
 * (`posts/../posts/a.png`). Nothing legitimate produces it, and "escapes then
 * returns" is a rule with an edge case, where "no `..` at all" has none.
 */
function toSegments(key: string, { allowTrailingSlash }: { allowTrailingSlash: boolean }): string[] {
  if (typeof key !== "string") {
    throw new UnsafeStorageKeyError("it is not a string")
  }
  if (key.includes(NULL_BYTE)) {
    throw new UnsafeStorageKeyError("it contains a null byte")
  }
  // Before anything else: a backslash is a separator on Windows and a legal
  // filename character on POSIX, so a key containing one means something
  // different on each host. Refusing it everywhere keeps one rule instead of
  // two, and closes `..\` traversal and `\\server\share` UNC paths at once.
  if (key.includes("\\")) {
    throw new UnsafeStorageKeyError("it contains a backslash")
  }
  if (key.startsWith("/")) {
    throw new UnsafeStorageKeyError("it is an absolute path")
  }
  if (WINDOWS_DRIVE.test(key)) {
    throw new UnsafeStorageKeyError("it names a drive")
  }

  const body = allowTrailingSlash ? key.replace(/\/+$/, "") : key
  if (body === "") {
    // Only reachable for a prefix, where it means the root; `resolvePrefix`
    // handles that before calling in.
    throw new UnsafeStorageKeyError("it is empty")
  }
  if (!allowTrailingSlash && key.endsWith("/")) {
    throw new UnsafeStorageKeyError("an object key may not end in a slash")
  }

  const segments = body.split("/")
  for (const segment of segments) {
    if (segment === "") {
      throw new UnsafeStorageKeyError("it has an empty path segment")
    }
    if (segment === "." || segment === "..") {
      throw new UnsafeStorageKeyError("it contains a relative path segment")
    }
  }
  return segments
}

/**
 * Lexical containment.
 *
 * `path.relative` rather than a `startsWith` on the string: `startsWith` treats
 * `/srv/storage-evil` as being inside `/srv/storage`, which is a real escape
 * hiding behind a prefix match.
 */
function assertInside(root: string, target: string): void {
  if (target === root) return
  const relative = path.relative(root, target)
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new UnsafeStorageKeyError("it resolves outside the storage root")
  }
}

/** The deepest ancestor of `target` that exists on disk, bounded by `root`. */
async function deepestExisting(root: string, target: string): Promise<string> {
  let current = target
  for (;;) {
    try {
      await fs.lstat(current)
      return current
    } catch {
      const parent = path.dirname(current)
      // `dirname` is a fixed point at the filesystem root; and once we are
      // shorter than the root there is nothing left worth checking.
      if (parent === current || parent.length < root.length) return root
      current = parent
    }
  }
}

/**
 * Real-path containment, which is the half that catches symlinks.
 *
 * The lexical check above is satisfied by `<root>/link/secret.txt` even when
 * `link` points at `/etc`. Only resolving the real path reveals it.
 *
 * Anything that IS a symlink is refused outright, including one pointing back
 * inside the root. FlowCMS never creates a symlink, so one that exists was put
 * there by something else; refusing all of them is a rule with no exception to
 * get wrong, and it costs nothing real.
 */
async function assertNoSymlinkEscape(root: string, target: string): Promise<void> {
  const existing = await deepestExisting(root, target)

  const stats = await fs.lstat(existing).catch(() => null)
  if (stats?.isSymbolicLink()) {
    throw new UnsafeStorageKeyError("it resolves through a symbolic link")
  }

  const real = await fs.realpath(existing).catch(() => null)
  if (real === null) return
  assertInside(root, real)
}

export interface LocalPathResolver {
  /** The storage root, resolved through its own real path. */
  readonly root: string
  /** An object key (`posts/a.png`) as an absolute host path. */
  resolveFile(key: string): Promise<string>
  /** A prefix (`posts/`, `posts`, or `""` for the root) as an absolute host path. */
  resolvePrefix(prefix: string): Promise<string>
}

/**
 * Builds a resolver bound to one storage root.
 *
 * The root is created if absent and then resolved through `realpath`, because
 * the root itself may be reached through a symlink — `/tmp` is one on macOS,
 * and without this every operation under a macOS temp directory would look like
 * an escape.
 */
export async function createLocalPathResolver(rootPath: string): Promise<LocalPathResolver> {
  await fs.mkdir(rootPath, { recursive: true })
  const root = await fs.realpath(rootPath)

  async function resolve(key: string, allowTrailingSlash: boolean): Promise<string> {
    const segments = toSegments(key, { allowTrailingSlash })
    const target = path.resolve(root, ...segments)
    // Lexical first: it is free, and it rejects the drive-letter and absolute
    // cases that `path.resolve` would otherwise have quietly honoured.
    assertInside(root, target)
    await assertNoSymlinkEscape(root, target)
    return target
  }

  return {
    root,
    resolveFile: (key) => resolve(key, false),
    async resolvePrefix(prefix) {
      // The empty prefix is the root, and it is the File Manager's opening
      // screen — not an error.
      if (prefix === "" || prefix === "/") return root
      return resolve(prefix, true)
    },
  }
}
