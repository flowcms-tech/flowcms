import { promises as fs } from "node:fs"
import path from "node:path"
import { createLocalPathResolver, type LocalPathResolver } from "../localPath"
import { StorageAccessError, StorageObjectNotFoundError } from "../StorageErrors"
import type { DirectoryListing, StorageDriver, StorageObjectSummary } from "../StorageDriver"

/**
 * The filesystem backend.
 *
 * Keys are POSIX-shaped on every host — `posts/2026/a.png` — and only become
 * host paths inside `localPath.ts`, which is the security boundary. Nothing in
 * this file joins a key onto the root itself.
 *
 * WHERE IT DIFFERS FROM S3, AND WHY THAT IS INVISIBLE TO CALLERS
 *
 * S3 has no directories: an empty folder only exists because the File Manager
 * writes a zero-byte object whose key ends in `/`. A filesystem has real
 * directories, so this driver uses them — and then presents the same logical
 * API, which is what lets the File Manager work unmodified on either backend:
 *
 *   createDirectory("a/b/")  ->  mkdir -p           (S3: put a marker object)
 *   listDirectory("a/")      ->  readdir, one level (S3: ListObjectsV2 + "/" delimiter)
 *   deletePrefix("a/")       ->  rm -r              (S3: list + batched DeleteObjects)
 *
 * The one genuine, unhidden difference is `listObjects`: S3 returns the
 * zero-byte markers as objects, and there is nothing here to return for them.
 * That is recorded in a test rather than smoothed over, because the migration
 * work has to know about it.
 *
 * ORDER. `readdir` returns entries in whatever order the filesystem likes,
 * while S3 returns keys in binary order. Every listing here is sorted, so a
 * caller cannot tell the backends apart by the shape of a folder.
 */

/** Everything a caller may see. Directories and regular files, nothing else. */
type Visible = "file" | "directory"

/**
 * Node's error codes, narrowed.
 *
 * `ENOENT` is usually not an error at all in this vocabulary — S3 answers a
 * missing prefix with an empty listing and a missing key's delete with success —
 * so it is checked far more often than it is thrown.
 */
function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

function isMissing(error: unknown): boolean {
  const code = codeOf(error)
  // ENOTDIR: a path component exists but is a file, so the child cannot. To a
  // caller asking about the child, that is "not there".
  return code === "ENOENT" || code === "ENOTDIR"
}

/** Wraps a genuine backend failure, keeping the cause for the server log. */
function accessError(operation: string, error: unknown): StorageAccessError {
  return new StorageAccessError(operation, error)
}

/** Normalises a prefix to `a/b/` form, or `""` for the root. */
function normalizePrefix(prefix: string): string {
  if (!prefix || prefix === "/") return ""
  return prefix.endsWith("/") ? prefix : `${prefix}/`
}

/**
 * Directory entries FlowCMS is willing to admit exist.
 *
 * Symlinks are excluded deliberately, and so is everything exotic (sockets,
 * FIFOs, devices). FlowCMS never creates any of them, so one that is present
 * was planted or predates the storage root's use — and listing it would invite
 * a caller to fetch it, which `localPath.ts` would then refuse anyway. Hiding
 * them keeps the listing and the fetch rules agreeing.
 */
async function visibleEntries(dir: string): Promise<{ name: string; kind: Visible }[]> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return []
    throw accessError("listing", error)
  }

  const visible: { name: string; kind: Visible }[] = []
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) visible.push({ name: entry.name, kind: "directory" })
    else if (entry.isFile()) visible.push({ name: entry.name, kind: "file" })
  }
  return visible
}

async function summarize(fullPath: string, key: string): Promise<StorageObjectSummary | null> {
  try {
    const stats = await fs.stat(fullPath)
    return { key, size: stats.size, lastModified: stats.mtime }
  } catch (error) {
    // A file removed between readdir and stat is not an error worth failing a
    // whole folder listing over.
    if (isMissing(error)) return null
    throw accessError("listing", error)
  }
}

/**
 * A driver bound to one storage root.
 *
 * A FACTORY RATHER THAN A SINGLETON, unlike `S3StorageDriver`. The S3 driver
 * reads its configuration per call from settings, so it has no per-instance
 * state; this one is defined by its root, and taking that as an argument is
 * what lets tests point it at a temporary directory and lets the next phase
 * point it wherever configuration says without changing this file.
 *
 * The root is created and resolved lazily on first use — not at construction —
 * so building a driver stays synchronous and side-effect free.
 */
export function createLocalStorageDriver(rootPath: string): StorageDriver {
  let resolverPromise: Promise<LocalPathResolver> | null = null

  function paths(): Promise<LocalPathResolver> {
    // Cached as the PROMISE, so concurrent first calls share one mkdir/realpath
    // rather than racing to create the same root.
    resolverPromise ??= createLocalPathResolver(rootPath)
    return resolverPromise
  }

  /** Recursive walk, used by `listObjects`. Files only, sorted by the caller. */
  async function collectFiles(dir: string, prefix: string, into: StorageObjectSummary[]): Promise<void> {
    for (const entry of await visibleEntries(dir)) {
      const key = `${prefix}${entry.name}`
      const full = path.join(dir, entry.name)
      if (entry.kind === "directory") {
        await collectFiles(full, `${key}/`, into)
      } else {
        const summary = await summarize(full, key)
        if (summary) into.push(summary)
      }
    }
  }

  async function ensureParent(target: string): Promise<void> {
    try {
      await fs.mkdir(path.dirname(target), { recursive: true })
    } catch (error) {
      throw accessError("write", error)
    }
  }

  const driver: StorageDriver = {
    name: "local",

    async uploadObject(key, body) {
      const target = await (await paths()).resolveFile(key)
      await ensureParent(target)
      try {
        // `writeFile` truncates, which is what makes an overwrite of a longer
        // object leave no tail of the old bytes behind.
        await fs.writeFile(target, body)
      } catch (error) {
        throw accessError("write", error)
      }
    },

    async downloadObject(key) {
      const target = await (await paths()).resolveFile(key)
      try {
        return await fs.readFile(target)
      } catch (error) {
        if (isMissing(error)) throw new StorageObjectNotFoundError(key)
        // EISDIR: the key names a directory. To a caller asking for an object,
        // that is the same answer as "not there".
        if (codeOf(error) === "EISDIR") throw new StorageObjectNotFoundError(key)
        throw accessError("read", error)
      }
    },

    async deleteObject(key) {
      const target = await (await paths()).resolveFile(key)
      try {
        await fs.unlink(target)
      } catch (error) {
        // S3's DeleteObject succeeds for a key that never existed, and the File
        // Manager relies on that: deleting twice must not surface an error.
        if (isMissing(error)) return
        throw accessError("delete", error)
      }
    },

    async listObjects(prefix = "") {
      const normalized = normalizePrefix(prefix)
      const dir = await (await paths()).resolvePrefix(prefix)
      const found: StorageObjectSummary[] = []
      await collectFiles(dir, normalized, found)
      return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    },

    async listDirectory(prefix = ""): Promise<DirectoryListing> {
      const normalized = normalizePrefix(prefix)
      const dir = await (await paths()).resolvePrefix(prefix)

      const directories: string[] = []
      const files: StorageObjectSummary[] = []

      for (const entry of await visibleEntries(dir)) {
        if (entry.kind === "directory") {
          directories.push(`${normalized}${entry.name}/`)
        } else {
          const summary = await summarize(path.join(dir, entry.name), `${normalized}${entry.name}`)
          if (summary) files.push(summary)
        }
      }

      directories.sort()
      files.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      return { directories, files }
    },

    async createDirectory(prefix) {
      const target = await (await paths()).resolvePrefix(prefix)
      try {
        await fs.mkdir(target, { recursive: true })
      } catch (error) {
        throw accessError("write", error)
      }
    },

    async deletePrefix(prefix) {
      const resolver = await paths()
      const target = await resolver.resolvePrefix(prefix)

      if (target === resolver.root) {
        // Emptying the root, not removing it. On Docker the root is a mount
        // point that cannot be unlinked, and even where it can be, the next
        // upload would have to re-create something the operator configured.
        for (const entry of await visibleEntries(target)) {
          await fs.rm(path.join(target, entry.name), { recursive: true, force: true })
        }
        return
      }

      try {
        // `force` makes a missing prefix a success, matching a `deletePrefix`
        // against S3, where listing nothing and deleting nothing is not an error.
        await fs.rm(target, { recursive: true, force: true })
      } catch (error) {
        throw accessError("delete", error)
      }
    },

    async copyObject(oldKey, newKey) {
      const resolver = await paths()
      // BOTH sides are resolved before anything is touched, so a hostile
      // destination cannot be discovered halfway through a write.
      const source = await resolver.resolveFile(oldKey)
      const destination = await resolver.resolveFile(newKey)
      await ensureParent(destination)
      try {
        await fs.copyFile(source, destination)
      } catch (error) {
        if (isMissing(error)) throw new StorageObjectNotFoundError(oldKey)
        throw accessError("copy", error)
      }
    },

    async renameObject(oldKey, newKey) {
      const resolver = await paths()
      const source = await resolver.resolveFile(oldKey)
      const destination = await resolver.resolveFile(newKey)
      await ensureParent(destination)

      try {
        // A single atomic call, where S3 needs copy-then-delete. The object is
        // never briefly absent and never briefly duplicated.
        await fs.rename(source, destination)
      } catch (error) {
        if (isMissing(error)) throw new StorageObjectNotFoundError(oldKey)
        if (codeOf(error) !== "EXDEV") throw accessError("rename", error)
        // EXDEV: source and destination are on different filesystems, which
        // happens the moment part of the storage root is its own mount. Rename
        // cannot cross that; copy-then-delete can.
        try {
          await fs.copyFile(source, destination)
          await fs.unlink(source)
        } catch (fallbackError) {
          throw accessError("rename", fallbackError)
        }
      }
    },

    async copyPrefix(oldPrefix, newPrefix) {
      const resolver = await paths()
      const source = await resolver.resolvePrefix(oldPrefix)
      const destination = await resolver.resolvePrefix(newPrefix)

      try {
        await fs.cp(source, destination, {
          recursive: true,
          force: true,
          // NEVER DEREFERENCE. With `dereference: true` a symlink inside the
          // tree is copied as its TARGET'S CONTENT, so a link pointing at
          // /etc/passwd would deposit that file's contents inside the storage
          // root under a name the File Manager serves.
          dereference: false,
          verbatimSymlinks: true,
          // AND NEVER COPY THE LINK EITHER. `dereference: false` alone still
          // reproduces the symlink at the destination — so a link escaping the
          // root gets propagated to a second place inside it. This driver
          // refuses to read one, but the storage root is also read by things
          // that are not this driver (backups, a future migration, an operator
          // with a shell), and one of those will follow it.
          //
          // Skipping them outright is the same rule the listing and the read
          // path already apply: a symlink is not part of FlowCMS's storage, so
          // it is not listed, not read, and not copied.
          filter: async (src) => {
            const stats = await fs.lstat(src).catch(() => null)
            return stats !== null && !stats.isSymbolicLink()
          },
        })
      } catch (error) {
        if (isMissing(error)) return
        throw accessError("copy", error)
      }
    },

    async renamePrefix(oldPrefix, newPrefix) {
      const resolver = await paths()
      const source = await resolver.resolvePrefix(oldPrefix)
      const destination = await resolver.resolvePrefix(newPrefix)

      const destinationExists = await fs
        .stat(destination)
        .then(() => true)
        .catch(() => false)

      // An S3 prefix rename MERGES: it copies each key onto the new prefix and
      // leaves anything already there alone. `fs.rename` cannot merge — onto a
      // non-empty directory it fails, and the exact errno varies by platform —
      // so the destination is checked first and the merge path taken
      // deliberately rather than discovered from an error code.
      if (!destinationExists) {
        try {
          await ensureParent(destination)
          await fs.rename(source, destination)
          return
        } catch (error) {
          if (isMissing(error)) return
          if (codeOf(error) !== "EXDEV") throw accessError("rename", error)
          // Fall through to copy-then-delete.
        }
      }

      await driver.copyPrefix(oldPrefix, newPrefix)
      await driver.deletePrefix(oldPrefix)
    },
  }

  return driver
}
