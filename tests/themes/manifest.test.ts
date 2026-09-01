import { describe, expect, it } from "vitest"
import { validateManifest, validateTheme } from "@/Themes/validation/manifest"
import type { ThemeManifest } from "@/Themes/contract/views"
import { FLOWCMS_VERSION } from "@/Framework/Config/version"

/**
 * Manifest validation is the gate every theme passes through before core will
 * render it, so it has to reject the near-misses, not just the obvious junk. A
 * manifest that is 90% right is the one that ships.
 */

const VALID: ThemeManifest = {
  slug: "sunrise",
  name: "Sunrise",
  version: "1.2.3",
  // DERIVED, because this fixture's job is to be the manifest that PASSES.
  // Pinned to `^0.1.0`, it stopped being one the moment FLOWCMS_VERSION reached
  // 0.2.0 — a caret range excludes the next minor below 1.0 — and the tests
  // that assert a valid theme is accepted started failing for a reason that had
  // nothing to do with what they check. Cases that exercise the range logic
  // itself override this and pass an explicit version, so they stay pinned.
  flowcmsCompat: `^${FLOWCMS_VERSION}`,
  menuSlots: ["primary", "footer"],
}

function Layout() {
  return null
}

describe("validateManifest — accepts", () => {
  it("a minimal valid manifest", () => {
    const result = validateManifest(VALID)
    expect(result.ok).toBe(true)
  })

  it("optional presentation fields", () => {
    const result = validateManifest({
      ...VALID,
      description: "A warm, readable theme.",
      author: "Someone",
      authorUrl: "https://example.test/themes",
      screenshot: "screenshot.png",
    })
    expect(result.ok).toBe(true)
  })

  it("a theme with no menu slots at all", () => {
    // A single-page theme has nowhere to put a menu. Requiring at least one
    // slot would force it to declare a slot it never renders, and an admin
    // would then be offered a menu assignment that does nothing.
    expect(validateManifest({ ...VALID, menuSlots: [] }).ok).toBe(true)
  })
})

describe("validateManifest — rejects", () => {
  const cases: Array<[string, unknown]> = [
    ["a non-object", "sunrise"],
    ["null", null],
    ["a missing slug", { ...VALID, slug: undefined }],
    ["an empty slug", { ...VALID, slug: "" }],
    ["an uppercase slug", { ...VALID, slug: "Sunrise" }],
    ["a slug with spaces", { ...VALID, slug: "sun rise" }],
    ["a slug with a path separator", { ...VALID, slug: "../etc" }],
    ["a slug with a trailing hyphen", { ...VALID, slug: "sunrise-" }],
    ["a missing name", { ...VALID, name: undefined }],
    ["an empty name", { ...VALID, name: "" }],
    ["a two-part version", { ...VALID, version: "1.2" }],
    ["a v-prefixed version", { ...VALID, version: "v1.2.3" }],
    ["a prerelease version", { ...VALID, version: "1.2.3-beta.1" }],
    ["a missing compatibility range", { ...VALID, flowcmsCompat: undefined }],
    ["an empty compatibility range", { ...VALID, flowcmsCompat: "" }],
    ["menuSlots as a string", { ...VALID, menuSlots: "primary" }],
    ["a missing menuSlots", { ...VALID, menuSlots: undefined }],
    ["an uppercase slot name", { ...VALID, menuSlots: ["Primary"] }],
    ["a slot name with a space", { ...VALID, menuSlots: ["main nav"] }],
    ["an authorUrl that is not a URL", { ...VALID, authorUrl: "example.test" }],
  ]

  it.each(cases)("rejects %s", (_label, value) => {
    const result = validateManifest(value)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
  })

  it("explains what was wrong rather than saying 'invalid'", () => {
    const result = validateManifest({ ...VALID, slug: "Sunrise" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(" ")).toMatch(/slug/i)
    }
  })
})

describe("validateTheme", () => {
  it("accepts a manifest plus a Layout", () => {
    expect(validateTheme({ manifest: VALID, Layout }).ok).toBe(true)
  })

  it("rejects a theme with no Layout", () => {
    const result = validateTheme({ manifest: VALID })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/Layout/)
  })

  it("rejects a theme whose Layout is not a component", () => {
    expect(validateTheme({ manifest: VALID, Layout: "<div/>" }).ok).toBe(false)
  })

  it("accepts a theme that implements no content surfaces", () => {
    // Optional by design: core falls back to the default theme per surface, so
    // a theme that only restyles the shell is legitimate and small.
    expect(validateTheme({ manifest: VALID, Layout }).ok).toBe(true)
  })

  it("rejects a theme that does not accept the running FlowCMS version", () => {
    const result = validateTheme({ manifest: { ...VALID, flowcmsCompat: "^2.0.0" }, Layout }, "0.1.0")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Both numbers in the message: "incompatible" alone sends an operator to
      // read source to find out what they actually have.
      expect(result.errors.join(" ")).toContain("^2.0.0")
      expect(result.errors.join(" ")).toContain("0.1.0")
    }
  })

  it("rejects an unparseable compatibility range rather than assuming it fits", () => {
    // Fails closed. The alternative is an incompatible theme activating and the
    // operator's first symptom being their own public site rendering wrongly.
    expect(validateTheme({ manifest: { ...VALID, flowcmsCompat: "~0.1.0" }, Layout }, "0.1.0").ok).toBe(false)
    expect(validateTheme({ manifest: { ...VALID, flowcmsCompat: "0.x" }, Layout }, "0.1.0").ok).toBe(false)
  })

  it("reports every problem at once, not just the first", () => {
    const result = validateTheme({ manifest: { ...VALID, slug: "Bad", version: "1" } }, "0.1.0")
    expect(result.ok).toBe(false)
    // Slug, version and the missing Layout — an author fixing one at a time
    // needs three round trips through a build.
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3)
  })
})
