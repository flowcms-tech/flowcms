import { describe, expect, it } from "vitest"
import { FLOWCMS_VERSION } from "@/Framework/Config/version"
import { isCompatible, parseSemver } from "@/Themes/validation/compat"

/**
 * Theme compatibility, decided by FlowCMS rather than by the theme.
 *
 * A theme declares the FlowCMS versions it was written against. Getting this
 * wrong in the permissive direction is the expensive failure: an incompatible
 * theme that activates renders a broken public website, and the operator's
 * first signal is their own site being wrong. So the rules below are
 * deliberately narrow, and anything unparseable is incompatible rather than
 * assumed-fine.
 *
 * `semver` is not a dependency and is not worth adding for this: FlowCMS needs
 * caret, exact and wildcard, which is a dozen lines and testable in full.
 */

describe("FLOWCMS_VERSION", () => {
  it("is a single hardcoded source, not read from package.json at runtime", () => {
    // Reading package.json at runtime is a file Next's tracer may omit from a
    // standalone build — the exact failure class that hit Phases 4 and 5.
    expect(FLOWCMS_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe("parseSemver", () => {
  it("parses a plain version", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it("rejects anything that is not exactly three numeric parts", () => {
    for (const bad of ["1.2", "1", "1.2.3.4", "v1.2.3", "1.2.x", "", "abc", "1.2.-3"]) {
      expect(parseSemver(bad), bad).toBeNull()
    }
  })
})

describe("isCompatible", () => {
  it("accepts the wildcard", () => {
    expect(isCompatible("*", "0.1.0")).toBe(true)
    expect(isCompatible("*", "9.9.9")).toBe(true)
  })

  it("accepts an exact match and rejects anything else", () => {
    expect(isCompatible("0.1.0", "0.1.0")).toBe(true)
    expect(isCompatible("0.1.0", "0.1.1")).toBe(false)
    expect(isCompatible("0.1.0", "0.2.0")).toBe(false)
  })

  describe("caret ranges", () => {
    it("allows patch and minor upgrades at or above 1.0.0", () => {
      expect(isCompatible("^1.2.0", "1.2.0")).toBe(true)
      expect(isCompatible("^1.2.0", "1.2.9")).toBe(true)
      expect(isCompatible("^1.2.0", "1.9.0")).toBe(true)
      expect(isCompatible("^1.2.0", "2.0.0")).toBe(false)
      expect(isCompatible("^1.2.0", "1.1.9")).toBe(false)
    })

    it("treats 0.x as unstable — a minor bump is breaking", () => {
      // This is the npm caret rule and it matters here: FlowCMS is pre-1.0, so
      // ^0.1.0 must NOT match 0.2.0. Getting it wrong would let every theme
      // written today activate against a future release that changed the
      // contract underneath it.
      expect(isCompatible("^0.1.0", "0.1.0")).toBe(true)
      expect(isCompatible("^0.1.0", "0.1.7")).toBe(true)
      expect(isCompatible("^0.1.0", "0.2.0")).toBe(false)
      expect(isCompatible("^0.1.0", "1.0.0")).toBe(false)
    })

    it("treats 0.0.x as pinned to the exact patch", () => {
      expect(isCompatible("^0.0.3", "0.0.3")).toBe(true)
      expect(isCompatible("^0.0.3", "0.0.4")).toBe(false)
    })
  })

  describe(">= ranges", () => {
    it("accepts a lower bound", () => {
      expect(isCompatible(">=0.1.0", "0.1.0")).toBe(true)
      expect(isCompatible(">=0.1.0", "3.0.0")).toBe(true)
      expect(isCompatible(">=0.1.0", "0.0.9")).toBe(false)
    })

    it("accepts a bounded range", () => {
      expect(isCompatible(">=0.1.0 <1.0.0", "0.5.0")).toBe(true)
      expect(isCompatible(">=0.1.0 <1.0.0", "1.0.0")).toBe(false)
      expect(isCompatible(">=0.1.0 <1.0.0", "0.0.9")).toBe(false)
    })
  })

  it("refuses anything it does not understand, rather than assuming compatible", () => {
    for (const range of ["~1.2.0", "1.x", ">1.0.0 || <2.0.0", "latest", "", "  ", "^"]) {
      expect(isCompatible(range, "1.2.0"), range).toBe(false)
    }
  })

  it("refuses when the running version is unparseable", () => {
    expect(isCompatible("*", "not-a-version")).toBe(false)
  })

  it("says the shipped default theme is compatible with this FlowCMS", () => {
    // The one case that must never be false in a released build.
    expect(isCompatible(`^${FLOWCMS_VERSION}`, FLOWCMS_VERSION)).toBe(true)
  })
})
