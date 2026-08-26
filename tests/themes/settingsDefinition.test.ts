import { describe, expect, it } from "vitest"
import {
  validateSettingsDefinition,
} from "@/Themes/validation/settingsDefinition"
import {
  defineThemeSettings,
  MAX_TEXT_LENGTH,
  MAX_SETTING_KEY_LENGTH,
} from "@/Themes/contract/settings"

/**
 * A theme's settings DEFINITION — declarative metadata, validated when the
 * registry is built.
 *
 * A theme is trusted application code, so this is not a sandbox. It exists so
 * that a mistake in a theme fails PREDICTABLY and EARLY — at registry
 * construction, where it makes that theme unavailable — rather than when an
 * operator opens the settings page and the form cannot be rendered.
 */

const field = {
  text: { key: "heading", type: "text", label: "Heading", default: "Hello" },
  boolean: { key: "showTagline", type: "boolean", label: "Show tagline", default: true },
  number: { key: "columns", type: "number", label: "Columns", default: 3, min: 1, max: 6 },
  select: {
    key: "width",
    type: "select",
    label: "Width",
    default: "normal",
    options: [
      { value: "narrow", label: "Narrow" },
      { value: "normal", label: "Normal" },
    ],
  },
  color: { key: "accent", type: "color", label: "Accent", default: "#3366ff" },
  textarea: { key: "notice", type: "textarea", label: "Notice", default: "" },
} as const

function definition(fields: unknown[], version = 1) {
  return { version, fields }
}

describe("a valid definition", () => {
  it("accepts every v0.1 field type", () => {
    const result = validateSettingsDefinition(definition(Object.values(field)))
    expect(result.ok).toBe(true)
  })

  it("accepts a theme with no settings at all", () => {
    // Most themes will not have any. `undefined` is not an error.
    expect(validateSettingsDefinition(undefined)).toEqual({ ok: true, definition: null })
  })

  it("accepts an empty field list", () => {
    const result = validateSettingsDefinition(definition([]))
    expect(result.ok).toBe(true)
  })

  it("keeps declaration order, because the admin form renders in that order", () => {
    const result = validateSettingsDefinition(definition([field.boolean, field.text]))
    if (!result.ok) throw new Error("expected ok")
    expect(result.definition?.fields.map((f) => f.key)).toEqual(["showTagline", "heading"])
  })
})

describe("field keys", () => {
  it("rejects a duplicate key", () => {
    const result = validateSettingsDefinition(definition([field.text, { ...field.text }]))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(" ")).toMatch(/duplicate/i)
  })

  it("rejects an empty key", () => {
    const result = validateSettingsDefinition(definition([{ ...field.text, key: "" }]))
    expect(result.ok).toBe(false)
  })

  it("rejects a key longer than the limit", () => {
    const key = "a".repeat(MAX_SETTING_KEY_LENGTH + 1)
    expect(validateSettingsDefinition(definition([{ ...field.text, key }])).ok).toBe(false)
  })

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects the prototype-sensitive key %s",
    (key) => {
      const result = validateSettingsDefinition(definition([{ ...field.text, key }]))
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors.join(" ")).toMatch(/reserved/i)
    },
  )

  it.each(["Has Space", "has.dot", "has/slash", "1leading", "UPPER_SNAKE"])(
    "rejects the malformed key %s",
    (key) => {
      expect(validateSettingsDefinition(definition([{ ...field.text, key }])).ok).toBe(false)
    },
  )

  it.each(["heading", "showTagline", "layoutWidth2"])("accepts the camelCase key %s", (key) => {
    expect(validateSettingsDefinition(definition([{ ...field.text, key }])).ok).toBe(true)
  })
})

describe("definition version", () => {
  it.each([0, -1, 1.5, "1", null, undefined])("rejects the version %p", (version) => {
    const result = validateSettingsDefinition({ version, fields: [field.text] })
    expect(result.ok).toBe(false)
  })

  it("accepts a positive integer", () => {
    expect(validateSettingsDefinition(definition([field.text], 7)).ok).toBe(true)
  })
})

describe("defaults must satisfy their own field", () => {
  it("rejects a text default that is not a string", () => {
    expect(validateSettingsDefinition(definition([{ ...field.text, default: 5 }])).ok).toBe(false)
  })

  it("rejects a text default longer than the core maximum", () => {
    const value = "x".repeat(MAX_TEXT_LENGTH + 1)
    expect(validateSettingsDefinition(definition([{ ...field.text, default: value }])).ok).toBe(false)
  })

  it("rejects a boolean default that is not a boolean", () => {
    expect(
      validateSettingsDefinition(definition([{ ...field.boolean, default: "true" }])).ok,
    ).toBe(false)
  })

  it("rejects a number default outside its own min/max", () => {
    expect(validateSettingsDefinition(definition([{ ...field.number, default: 9 }])).ok).toBe(false)
  })

  it("rejects a non-finite number default", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateSettingsDefinition(definition([{ ...field.number, default: value }])).ok).toBe(false)
    }
  })

  it("rejects a select default that is not one of its options", () => {
    expect(validateSettingsDefinition(definition([{ ...field.select, default: "wide" }])).ok).toBe(false)
  })

  it("requires a default on every field", () => {
    const { default: _omitted, ...noDefault } = field.text
    expect(validateSettingsDefinition(definition([noDefault])).ok).toBe(false)
  })
})

describe("select options", () => {
  it("rejects an empty option list", () => {
    expect(validateSettingsDefinition(definition([{ ...field.select, options: [] }])).ok).toBe(false)
  })

  it("rejects duplicate option values", () => {
    const options = [
      { value: "a", label: "A" },
      { value: "a", label: "Also A" },
    ]
    expect(
      validateSettingsDefinition(definition([{ ...field.select, options, default: "a" }])).ok,
    ).toBe(false)
  })

  it("rejects options on a non-select field", () => {
    expect(
      validateSettingsDefinition(definition([{ ...field.text, options: [{ value: "a", label: "A" }] }])).ok,
    ).toBe(false)
  })
})

describe("number bounds", () => {
  it("rejects min greater than max", () => {
    expect(
      validateSettingsDefinition(definition([{ ...field.number, min: 10, max: 2, default: 5 }])).ok,
    ).toBe(false)
  })

  it("rejects a non-positive step", () => {
    expect(
      validateSettingsDefinition(definition([{ ...field.number, step: 0 }])).ok,
    ).toBe(false)
  })
})

describe("colour defaults", () => {
  it.each(["#fff", "#FFF", "#3366ff", "#3366FFAA"])("accepts %s", (value) => {
    expect(validateSettingsDefinition(definition([{ ...field.color, default: value }])).ok).toBe(true)
  })

  it.each([
    "red",
    "rgb(1,2,3)",
    "var(--x)",
    "url(evil)",
    "expression(1)",
    "#ff",
    "#12345",
    "#gggggg",
    "#fff; background-image: url(x)",
  ])("rejects %s", (value) => {
    expect(validateSettingsDefinition(definition([{ ...field.color, default: value }])).ok).toBe(false)
  })
})

describe("text maximum", () => {
  it("lets a theme declare a STRICTER maximum than core", () => {
    const result = validateSettingsDefinition(
      definition([{ ...field.text, maxLength: 10, default: "short" }]),
    )
    expect(result.ok).toBe(true)
  })

  it("refuses a theme asking for MORE than the core maximum", () => {
    const result = validateSettingsDefinition(
      definition([{ ...field.text, maxLength: MAX_TEXT_LENGTH + 1 }]),
    )
    expect(result.ok).toBe(false)
  })
})

describe("defineThemeSettings", () => {
  it("returns the definition unchanged, so it is usable as a value and a type", () => {
    const settings = defineThemeSettings({
      version: 1,
      fields: [
        { key: "showTagline", type: "boolean", label: "Show tagline", default: true },
        { key: "heading", type: "text", label: "Heading", default: "Hi" },
      ],
    })
    expect(settings.version).toBe(1)
    expect(settings.fields).toHaveLength(2)
  })
})
