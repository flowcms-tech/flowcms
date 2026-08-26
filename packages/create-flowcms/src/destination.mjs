import { existsSync, readdirSync, statSync, lstatSync } from "node:fs"
import { resolve, parse, basename, sep } from "node:path"
import { UsageError } from "./args.mjs"

/**
 * Deciding whether a destination may be written to.
 *
 * THE RULE: the directory must not exist, or must exist and be empty. Nothing
 * else. Merging FlowCMS into somebody's existing project is a real feature with
 * real questions — which files win, what happens to their `package.json` — and
 * guessing at it would eventually delete work somebody cared about.
 *
 * Every check here runs BEFORE anything is written. A validation that happens
 * halfway through a copy is not validation, it is a mess with an error message.
 */

/**
 * Entries that do not make a directory "non-empty".
 *
 * Only macOS's Finder metadata. Deliberately not `.git`: a directory with a
 * repository in it is somebody's project, and scaffolding into it is exactly
 * the case this refuses.
 */
const IGNORABLE = new Set([".DS_Store"])

export function inspectDestination(raw, cwd = process.cwd()) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new UsageError("Project directory cannot be empty.")
  }

  const target = resolve(cwd, raw)

  // The filesystem root, or a drive root on Windows. `parse().root === dir`
  // catches "/" and "C:\" without special-casing either platform.
  if (parse(target).root === target) {
    throw new UsageError("Refusing to scaffold into the filesystem root.")
  }

  // `.` and `./` resolve to the working directory. Almost always someone
  // meaning "here" in a directory that already holds something — and if it is
  // genuinely empty the emptiness check below allows it.
  if (target === resolve(cwd) && !isEmptyDirectory(target)) {
    throw new UsageError(
      "Refusing to scaffold into the current directory because it is not empty. " +
        "Pass a new directory name instead.",
    )
  }

  if (existsSync(target)) {
    // lstat, not stat: a symlink pointing at an empty directory would pass a
    // stat-based check and then be written through, which puts a generated
    // project somewhere the operator did not name.
    const stats = lstatSync(target)

    if (stats.isSymbolicLink()) {
      throw new UsageError(`"${raw}" is a symbolic link. Pass a real directory path.`)
    }
    if (!stats.isDirectory()) {
      throw new UsageError(`"${raw}" already exists and is a file, not a directory.`)
    }
    if (!isEmptyDirectory(target)) {
      throw new UsageError(
        `"${raw}" already exists and is not empty. ` +
          "create-flowcms will not write into a directory that already has files in it.",
      )
    }
    return { path: target, existed: true }
  }

  // The parent has to exist. Creating a whole missing path for someone is how a
  // typo becomes a directory tree in their home folder.
  const parent = resolve(target, "..")
  if (!existsSync(parent)) {
    throw new UsageError(`The parent directory "${parent}" does not exist.`)
  }
  if (!statSync(parent).isDirectory()) {
    throw new UsageError(`"${parent}" is not a directory.`)
  }

  return { path: target, existed: false }
}

export function isEmptyDirectory(path) {
  try {
    return readdirSync(path).filter((entry) => !IGNORABLE.has(entry)).length === 0
  } catch {
    return false
  }
}

/**
 * Assert a template-relative path stays inside the destination.
 *
 * The template is first-party and every entry in it comes from this
 * repository's own build, so this cannot fire today. It is here because it is
 * three lines, and because the day it CAN fire — a manifest bug, a crafted
 * archive entry — the consequence is writing outside the directory the operator
 * named.
 */
export function assertInside(destination, candidate) {
  const resolved = resolve(destination, candidate)
  const root = resolve(destination)
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error(`Template entry "${candidate}" escapes the destination directory.`)
  }
  return resolved
}

export { basename }
