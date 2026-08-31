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

/**
 * What the destination filesystem does with case — including "we could not
 * find out".
 *
 * A TRI-STATE, AND THAT IS THE POINT. Phase 4a returned a boolean and fell back
 * to "case-sensitive" when the probe failed. That fallback is unsafe in exactly
 * one direction, which is the direction that loses data: if the real
 * destination is case-INSENSITIVE, treating it as sensitive lets `Photo.png`
 * and `photo.png` both through as distinct keys, and the second silently
 * overwrites the first at the destination. The migration reports success and
 * one file is gone.
 *
 * There is no safe permissive default, so there is no default. An
 * indeterminate probe is its own answer and it BLOCKS.
 */
export type DestinationCaseSensitivity = "sensitive" | "insensitive" | "unknown"

/** A definite answer — the only thing a scanner may be built from. */
export type KnownCaseSensitivity = Exclude<DestinationCaseSensitivity, "unknown">

export interface CaseProbeResult {
  sensitivity: DestinationCaseSensitivity
  /** Operator-facing reason when the answer is `unknown`. Never a raw errno. */
  detail?: string
}

/**
 * The job-level gate: may a migration to this destination proceed at all?
 *
 * Returns a blocking problem, or null. Separate from `inspect()` because an
 * unknown case behaviour is a fact about the DESTINATION, not about any
 * particular key — reporting it once is right, and reporting it against every
 * one of half a million keys would bury it.
 */
export function caseSensitivityBlocker(probe: CaseProbeResult): string | null {
  if (probe.sensitivity !== "unknown") return null
  return (
    "FlowCMS could not determine whether the destination filesystem treats " +
    "`Photo.png` and `photo.png` as the same file" +
    (probe.detail ? ` (${probe.detail})` : "") +
    ". Migrating without knowing could silently overwrite one file with another, so it will not " +
    "start until this is resolved."
  )
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
  /**
   * From the real destination probe, never from `process.platform`.
   *
   * Typed to EXCLUDE `unknown`, so a caller that has not resolved an
   * indeterminate probe cannot construct a scanner at all — the gate is the
   * type system rather than a runtime check somebody can forget.
   */
  caseSensitivity: KnownCaseSensitivity
}): CompatibilityScanner {
  /** normalised path -> the original key that claimed it. */
  const claimed = new Map<string, string>()
  /** Every directory path implied by a key, so `foo` vs `foo/bar` is catchable. */
  const directories = new Map<string, string>()
  /** Every key stored as a file. */
  const files = new Map<string, string>()

  const caseSensitive = options.caseSensitivity === "sensitive"
  const normalise = (value: string) => (caseSensitive ? value : value.toLowerCase())

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
          reason: caseSensitive ? "path_collision" : "case_collision",
          detail: caseSensitive
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
 * AN INDETERMINATE PROBE RETURNS `unknown` AND BLOCKS. Phase 4a fell back to
 * "case-sensitive" here, which is unsafe in precisely the direction that loses
 * data: if the destination is really case-INSENSITIVE, treating it as sensitive
 * lets `Photo.png` and `photo.png` through as two keys, and the second
 * overwrites the first at the destination while the migration reports success.
 *
 * There is no safe permissive default, so this returns no default at all.
 */
export async function probeDestinationCaseSensitivity(root: string): Promise<CaseProbeResult> {
  const id = randomUUID()
  const lower = join(root, `.flowcms-case-probe-${id}`)
  const upper = join(root, `.FLOWCMS-CASE-PROBE-${id.toUpperCase()}`)

  try {
    await fs.mkdir(root, { recursive: true })
  } catch (error) {
    return { sensitivity: "unknown", detail: describeProbeFailure(error, "the directory could not be created") }
  }

  try {
    await fs.writeFile(lower, "probe")
  } catch (error) {
    return { sensitivity: "unknown", detail: describeProbeFailure(error, "a test file could not be written") }
  }

  try {
    // If the filesystem is case-insensitive this resolves to the file just
    // written; if sensitive it does not exist.
    await fs.stat(upper)
    return { sensitivity: "insensitive" }
  } catch (error) {
    const code = (error as { code?: string })?.code
    // ENOENT is the ANSWER — the other case genuinely does not exist, so the
    // filesystem is case-sensitive. Any other error means the question was not
    // answered, which is not the same thing and must not be read as one.
    if (code === "ENOENT") return { sensitivity: "sensitive" }
    return { sensitivity: "unknown", detail: describeProbeFailure(error, "the test file could not be read back") }
  } finally {
    await fs.rm(lower, { force: true }).catch(() => {})
    await fs.rm(upper, { force: true }).catch(() => {})
  }
}

/** Operator-facing, never a raw errno or a path. */
function describeProbeFailure(error: unknown, what: string): string {
  const code = (error as { code?: string })?.code
  if (code === "EACCES" || code === "EPERM") return `${what} — permission denied`
  if (code === "EROFS") return `${what} — the destination is read-only`
  if (code === "ENOSPC") return `${what} — the destination is full`
  return what
}
