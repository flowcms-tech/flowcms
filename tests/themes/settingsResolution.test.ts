import { describe, expect, it } from "vitest"
import { defineThemeSettings } from "@/Themes/contract/settings"
import { resolveSettingsRow, MAX_SETTINGS_BYTES } from "@/Framework/Settings/themeSettingsResolve"

/**
 * Turning a stored row into the values a theme renders from.
 *
 * THE READ PATH IS RESILIENT. It is handed whatever the database holds — a row
 * written by an older version of the theme, a value an operator set before a
 * field's options changed, or JSON somebody edited by hand — and its contract
 * is that it always returns a complete, correctly-typed settings object.
 *
 * It never writes. A GET that repaired the row would destroy the operator's
 * stored intent silently, and would do it from a render path.
 *
 * A corrupt row is NOT a database outage. This function only sees rows that
 * were read successfully; an unreachable database throws further out, where it
 * belongs.
 */

const definition = defineThemeSettings({
  version: 2,
  fields: [
    { key: "showTagline", type: "boolean", label: "Show tagline", default: true },
    { key: "heading", type: "text", label: "Heading", default: "Welcome", maxLength: 20 },
    { key: "columns", type: "number", label: "Columns", default: 3, min: 1, max: 6 },
    {
      key: "width",
      type: "select",
      label: "Width",
      default: "normal",
      options: [
        { value: "narrow", label: "Narrow" },
        { value: "normal", label: "Normal" },
      ],
    },
    { key: "accent", type: "color", label: "Accent", default: "#3366ff" },
  ],
})

const DEFAULTS = {
  showTagline: true,
  heading: "Welcome",
  columns: 3,
  width: "normal",
  accent: "#3366ff",
}

function resolve(json: string | null, schemaVersion: number | null = 2) {
  return resolveSettingsRow({
    themeSlug: "default",
    definition,
    row: json === null ? null : { values: json, schemaVersion: schemaVersion ?? 0 },
  })
}

describe("no stored row", () => {
  const result = resolve(null)

  it("returns the declared defaults", () => {
    expect(result.values).toEqual(DEFAULTS)
  })

  it("reports that nothing is stored", () => {
    expect(result.stored).toBe(false)
    expect(result.issues).toEqual([])
  })

  it("is the ordinary state, not a problem", () => {
    expect(result.schemaVersion).toBeNull()
    expect(result.definitionVersion).toBe(2)
  })
})

describe("a theme with no settings definition", () => {
  it("resolves to an empty object rather than throwing", () => {
    const result = resolveSettingsRow({ themeSlug: "plain", definition: null, row: null })
    expect(result.values).toEqual({})
    expect(result.definitionVersion).toBeNull()
  })
})

describe("valid stored values", () => {
  const result = resolve(JSON.stringify({ showTagline: false, heading: "Hi", columns: 5 }))

  it("overrides the fields it names", () => {
    expect(result.values.showTagline).toBe(false)
    expect(result.values.heading).toBe("Hi")
    expect(result.values.columns).toBe(5)
  })

  it("leaves the rest at their defaults", () => {
    expect(result.values.width).toBe("normal")
    expect(result.values.accent).toBe("#3366ff")
  })

  it("raises no issues", () => {
    expect(result.issues).toEqual([])
    expect(result.stored).toBe(true)
  })
})

describe("invalid stored values fall back per field", () => {
  it.each([
    ["boolean given a string", { showTagline: "yes" }, "showTagline", true],
    ["number given a string", { columns: "4" }, "columns", 3],
    ["number below min", { columns: 0 }, "columns", 3],
    ["number above max", { columns: 99 }, "columns", 3],
    ["number not finite", { columns: null }, "columns", 3],
    ["text given a number", { heading: 7 }, "heading", "Welcome"],
    ["text over its own maxLength", { heading: "x".repeat(21) }, "heading", "Welcome"],
    ["select value no longer offered", { width: "wide" }, "width", "normal"],
    ["colour in a rejected format", { accent: "red" }, "accent", "#3366ff"],
    ["colour with a CSS payload", { accent: "#fff; background: url(x)" }, "accent", "#3366ff"],
  ])("%s falls back to the default", (_name, stored, key, expected) => {
    const result = resolve(JSON.stringify(stored))
    expect(result.values[key as keyof typeof result.values]).toBe(expected)
    expect(result.issues.some((issue) => issue.field === key)).toBe(true)
  })

  it("only the invalid field falls back; valid siblings survive", () => {
    const result = resolve(JSON.stringify({ columns: 99, heading: "Kept" }))
    expect(result.values.columns).toBe(3)
    expect(result.values.heading).toBe("Kept")
    expect(result.issues).toHaveLength(1)
  })
})

describe("unknown stored keys", () => {
  const result = resolve(JSON.stringify({ heading: "Hi", removedField: "old", another: 1 }))

  it("never reach the theme", () => {
    expect(Object.keys(result.values).sort()).toEqual(Object.keys(DEFAULTS).sort())
    expect("removedField" in result.values).toBe(false)
  })

  it("are reported to the admin so an operator can see them", () => {
    const unknown = result.issues.filter((issue) => issue.kind === "unknown-key")
    expect(unknown.map((issue) => issue.field).sort()).toEqual(["another", "removedField"])
  })

  it("are preserved in the row for the write path to carry forward", () => {
    expect(result.unknownValues).toEqual({ removedField: "old", another: 1 })
  })
})

describe("prototype-sensitive stored keys", () => {
  it("are ignored and cannot reach the resolved object", () => {
    const hostile = '{"__proto__":{"polluted":true},"constructor":{"x":1},"heading":"safe"}'
    const result = resolve(hostile)

    expect(result.values.heading).toBe("safe")
    expect((Object.prototype as unknown as { polluted?: unknown }).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it("builds a null-prototype object, so a later lookup cannot walk the chain", () => {
    const result = resolve(JSON.stringify({ heading: "x" }))
    expect(Object.getPrototypeOf(result.values)).toBeNull()
  })
})

describe("corrupt JSON", () => {
  const result = resolve("{not json at all")

  it("resolves to the declared defaults", () => {
    expect(result.values).toEqual(DEFAULTS)
  })

  it("raises exactly one corrupt-json issue", () => {
    expect(result.issues.map((issue) => issue.kind)).toEqual(["corrupt-json"])
  })

  it("does not report the raw stored text back", () => {
    // The row is operator data and may be anything; the message names the
    // problem, not the payload.
    expect(JSON.stringify(result.issues)).not.toContain("not json at all")
  })

  it.each(["null", "[]", '"a string"', "42", "true"])(
    "treats non-object JSON (%s) as corrupt",
    (json) => {
      const result = resolve(json)
      expect(result.values).toEqual(DEFAULTS)
      expect(result.issues[0].kind).toBe("corrupt-json")
    },
  )
})

describe("definition version mismatch", () => {
  const result = resolve(JSON.stringify({ heading: "From v1" }), 1)

  it("still resolves every field the definition declares", () => {
    expect(result.values.heading).toBe("From v1")
    expect(result.values.columns).toBe(3)
  })

  it("reports the mismatch with both versions", () => {
    const issue = result.issues.find((i) => i.kind === "version-mismatch")
    expect(issue).toBeDefined()
    expect(result.schemaVersion).toBe(1)
    expect(result.definitionVersion).toBe(2)
  })

  it("is not treated as corruption", () => {
    expect(result.issues.some((i) => i.kind === "corrupt-json")).toBe(false)
  })
})

describe("size limit", () => {
  it("exposes a byte ceiling the write path can enforce", () => {
    expect(MAX_SETTINGS_BYTES).toBeGreaterThan(1000)
    expect(MAX_SETTINGS_BYTES).toBeLessThanOrEqual(64 * 1024)
  })
})

describe("the resolver never mutates its input", () => {
  it("leaves the row object untouched", () => {
    const row = { values: JSON.stringify({ columns: 99 }), schemaVersion: 1 }
    const snapshot = JSON.stringify(row)
    resolveSettingsRow({ themeSlug: "default", definition, row })
    expect(JSON.stringify(row)).toBe(snapshot)
  })
})
