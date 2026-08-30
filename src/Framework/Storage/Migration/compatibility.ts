import { promises as fs } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { localKeyProblem } from "../localPath"

/**
 * CAN THE DESTINATION ACTUALLY HOLD WHAT THE SOURCE CONTAINS?
 *
 * A hard gate before any copying, and it exists because S3 and a filesystem do
 * not agree about what a name is. An S3 key is an opaque byte string: `a/../b`,
 * `back\slash`, `CON`, `photo.png` and `Photo.png` are five perfectly ordinary
 * distinct keys. On a filesystem, one is a traversal, one is a separator, one
 * is a device on Windows, and two of them may be the same file.
 *
 * NOTHING IS RENAMED OR SANITISED. That is the central rule. Every stored
 * reference in the database — a post's `featuredImageKey`, an `<img>` in a page
 * body — names the key exactly, so silently rewriting one during a migration
 * would break the reference and produce a broken image with no error anywhere.
 * A key that cannot be represented is REPORTED and the migration stops; the
 * operator resolves it at the source, where the references can be updated with
 * it.
 *
 * A SINGLE incompatible entry blocks readiness. There is no partial migration:
 * a site whose images are 99% moved is a broken site.
 */

export type CompatibilityReason =
  /** The local driver itself would refuse the key — traversal, backslash, absolute, null byte. */
  | "unsafe_key"
  /** A path component Windows reserves for a device, in any casing, with or without extension. */
  | "reserved_name"
  /** A component ending in `.` — Windows silently strips it, so two keys become one file. */
  | "trailing_dot"
  /** A component ending in a space — same silent strip, same collision. */
  | "trailing_space"
  /** Two distinct source keys that differ only in case, on a case-insensitive destination. */
  | "case_collision"
  /** Two distinct source keys that map to the same destination path for any other reason. */
  | "path_collision"
  /** One key is a file and another needs it to be a directory. */
  | "file_directory_collision"

export interface CompatibilityIssue {
  key: string
  reason: CompatibilityReason
  /** Operator-facing. Names the problem; never proposes a rename. */
  detail: string
  /** The already-seen key this one collides with, where relevant. */
  collidesWith?: string
}

/**
 * Windows device names, which are reserved in EVERY directory and regardless of
 * extension — `CON`, `con`, `CON.txt` and `CON.png` all fail.
 *
 * Checked on every destination, not only when running on Windows: a migration
 * planned on Linux against a volume that will later be read on Windows, or a
 * bind mount from a Windows host, hits exactly the same wall. The cost of
 * checking is one comparison; the cost of not checking is discovering it after
 * cutover.
 */
const WINDOWS_RESERVED = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
])

function stem(component: string): string {
  const dot = component.indexOf(".")
  return (dot === -1 ? component : component.slice(0, dot)).toLowerCase()
}

export interface ScannedEntry {
  key: string
  kind: "file" | "directory"
}

export interface CompatibilityScanner {
  /** Returns an issue, or null when the entry is representable. */
  inspect(entry: ScannedEntry): CompatibilityIssue | null
}

/**
 * A scanner for one destination.
 *
 * STATEFUL, because collisions are a property of a SET of keys rather than of
 * any one key. It accumulates what it has seen so that the second of two
 * colliding keys can name the first — an operator told "these two keys collide"
 * can act; one told "this key collides with something" cannot.
 *
 * Memory is bounded by the number of keys, not their size: one normalised
 * string per entry. For a store large enough for that to matter, the scan is
 * batched and the accumulated set is the only thing that has to persist.
 */
export function createCompatibilityScanner(options: {
  /** From the real destination probe, not from `process.platform`. */
  caseSensitive: boolean
}): CompatibilityScanner {
  /** normalised path -> the original key that claimed it. */
  const claimed = new Map<string, string>()
  /** Every directory path implied by a key, so `foo` vs `foo/bar` is catchable. */
  const directories = new Map<string, string>()
  /** Every key stored as a file. */
  const files = new Map<string, string>()

  const normalise = (value: string) => (options.caseSensitive ? value : value.toLowerCase())

  return {
    inspect(entry) {
      const { key, kind } = entry
      const isDirectory = kind === "directory"
      // A directory entry's key ends in `/`; compare on the path without it.
      const path = isDirectory ? key.replace(/\/+$/, "") : key

      // 1. Would the local driver refuse it outright? Asked of the driver's own
      //    rule rather than a copy of it, so the two cannot drift.
      const problem = localKeyProblem(key, { allowTrailingSlash: isDirectory })
      if (problem) {
        return {
          key,
          reason: "unsafe_key",
          detail: `This key cannot become a file path: ${problem}.`,
        }
      }

      const components = path.split("/").filter(Boolean)

      // 2. Per-component hazards.
      for (const component of components) {
        if (WINDOWS_RESERVED.has(stem(component))) {
          return {
            key,
            reason: "reserved_name",
            detail:
              `"${component}" is a reserved device name on Windows and cannot be a file or ` +
              `folder there, in any casing or with any extension.`,
          }
        }
        if (component.endsWith(".")) {
          return {
            key,
            reason: "trailing_dot",
            detail:
              `"${component}" ends in a dot. Windows silently removes it, so this key and one ` +
              `without the dot would become the same file.`,
          }
        }
        if (component.endsWith(" ")) {
          return {
            key,
            reason: "trailing_space",
            detail:
              `"${component}" ends in a space. Windows silently removes it, so this key and one ` +
              `without the space would become the same file.`,
          }
        }
      }

      // 3. Collisions with entries already seen.
      const normalised = normalise(path)

      // 4. A file where another key needs a directory, or the reverse.
      //    `foo` and `foo/bar.jpg` cannot both exist: one needs `foo` to be a
      //    file, the other needs it to be a folder.
      //
      //    CHECKED BEFORE THE GENERIC PATH COLLISION, deliberately. Both are
      //    collisions and both block, but this one names the actual problem —
      //    an operator told "two keys map to the same path" for `foo` and
      //    `foo/` would go looking for a duplicate key that does not exist.
      if (isDirectory) {
        const asFile = files.get(normalised)
        if (asFile !== undefined) {
          return {
            key,
            reason: "file_directory_collision",
            detail: "This folder has the same path as an existing file.",
            collidesWith: asFile,
          }
        }
      } else {
        const asDirectory = directories.get(normalised)
        if (asDirectory !== undefined) {
          return {
            key,
            reason: "file_directory_collision",
            detail: "This file has the same path as a folder another key requires.",
            collidesWith: asDirectory,
          }
        }
      }

      // 5. Any other two distinct source keys landing on one destination path.
      //    Which one survived would depend on copy order, and one file would be
      //    lost.
      const previous = claimed.get(normalised)
      if (previous !== undefined && previous !== key) {
        return {
          key,
          reason: options.caseSensitive ? "path_collision" : "case_collision",
          detail: options.caseSensitive
            ? "Two different keys map to the same destination path."
            : "The destination filesystem is case-insensitive, so these two keys are one file there.",
          collidesWith: previous,
        }
      }

      // A file's ancestors must all be directories.
      if (!isDirectory) {
        for (let i = 1; i < components.length; i += 1) {
          const ancestor = normalise(components.slice(0, i).join("/"))
          const asFile = files.get(ancestor)
          if (asFile !== undefined) {
            return {
              key,
              reason: "file_directory_collision",
              detail: "A parent folder of this key is stored as a file by another key.",
              collidesWith: asFile,
            }
          }
          directories.set(ancestor, key)
        }
      }

      claimed.set(normalised, key)
      if (isDirectory) directories.set(normalised, key)
      else files.set(normalised, key)

      return null
    },
  }
}

/**
 * Whether the destination filesystem distinguishes `A` from `a`.
 *
 * PROBED, NOT ASSUMED. `process.platform` is a guess: a Linux container can
 * mount a case-insensitive volume, macOS is case-insensitive by default, and a
 * Windows bind mount into a Linux container behaves like its host. The
 * filesystem is a fact and it is cheap to ask.
 *
 * Writes one uniquely-named file, asks for it under a different case, and
 * removes it. Both names are dot-prefixed and carry a UUID so a concurrent
 * probe cannot collide with this one.
 *
 * Falls back to `true` (case-SENSITIVE) if the probe cannot run. That is the
 * conservative direction: assuming sensitivity means two keys differing only in
 * case are treated as distinct, which is what S3 says they are. Assuming the
 * opposite would report collisions that are not real and block a valid
 * migration.
 */
export async function probeDestinationCaseSensitivity(root: string): Promise<boolean> {
  const id = randomUUID()
  const lower = join(root, `.flowcms-case-probe-${id}`)
  const upper = join(root, `.FLOWCMS-CASE-PROBE-${id.toUpperCase()}`)

  try {
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(lower, "probe")
    try {
      // If the filesystem is case-insensitive this resolves to the file just
      // written; if sensitive it does not exist.
      await fs.stat(upper)
      return false
    } catch {
      return true
    }
  } catch {
    return true
  } finally {
    await fs.rm(lower, { force: true }).catch(() => {})
    await fs.rm(upper, { force: true }).catch(() => {})
  }
}
