/**
 * Theme compatibility ranges.
 *
 * A theme declares which FlowCMS versions it was written against; FlowCMS
 * decides whether that is satisfied. The check is deliberately narrow and
 * **fails closed**: an unrecognised range is incompatible, never
 * assumed-compatible. Getting that backwards means an incompatible theme
 * activates and the operator's first symptom is their own public site
 * rendering wrongly.
 *
 * `semver` is not a dependency of FlowCMS and is not worth adding for this.
 * The supported grammar is small enough to implement completely and test
 * exhaustively, which is a better trade than a package for one predicate:
 *
 *   *                  any version
 *   1.2.3              exactly this version
 *   ^1.2.3             npm caret semantics, including the 0.x rules
 *   >=1.2.3            lower bound
 *   >=1.2.3 <2.0.0     bounded range
 *
 * Anything else — tilde, `x` wildcards, `||` unions — is refused. Themes that
 * need those can widen to `>=`.
 */

export interface Semver {
  major: number
  minor: number
  patch: number
}

const EXACT = /^(\d+)\.(\d+)\.(\d+)$/

export function parseSemver(value: string): Semver | null {
  const match = EXACT.exec(value.trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/** -1, 0 or 1. */
function compare(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

/**
 * npm caret semantics, including the pre-1.0 rules that matter most here.
 *
 * FlowCMS is 0.x, so `^0.1.0` must NOT match `0.2.0`: below 1.0.0 a minor bump
 * is a breaking change by convention, and every theme written today would
 * otherwise silently claim compatibility with a release that changed the
 * contract underneath it.
 */
function satisfiesCaret(range: Semver, version: Semver): boolean {
  if (compare(version, range) < 0) return false

  if (range.major > 0) return version.major === range.major
  if (range.minor > 0) return version.major === 0 && version.minor === range.minor
  // ^0.0.x is pinned to the exact patch.
  return version.major === 0 && version.minor === 0 && version.patch === range.patch
}

export function isCompatible(compatRange: string, flowcmsVersion: string): boolean {
  const version = parseSemver(flowcmsVersion)
  if (!version) return false

  const range = compatRange.trim()
  if (range === "") return false
  if (range === "*") return true

  const exact = parseSemver(range)
  if (exact) return compare(version, exact) === 0

  if (range.startsWith("^")) {
    const caret = parseSemver(range.slice(1))
    return caret ? satisfiesCaret(caret, version) : false
  }

  // ">=x.y.z" optionally followed by "<a.b.c". Any other combination of
  // comparators is not supported and therefore not compatible.
  const parts = range.split(/\s+/)
  if (parts.length > 2) return false

  let lower: Semver | null = null
  let upper: Semver | null = null

  for (const part of parts) {
    if (part.startsWith(">=")) {
      if (lower) return false
      lower = parseSemver(part.slice(2))
      if (!lower) return false
    } else if (part.startsWith("<")) {
      if (upper) return false
      upper = parseSemver(part.slice(1))
      if (!upper) return false
    } else {
      return false
    }
  }

  if (!lower) return false
  if (compare(version, lower) < 0) return false
  if (upper && compare(version, upper) >= 0) return false
  return true
}
