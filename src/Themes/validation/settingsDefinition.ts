/**
 * CORE-ONLY validation of a theme's settings DEFINITION.
 *
 * Moved out of `Themes/contract/settings.ts` in Phase 7.2, and the reason is
 * distribution rather than tidiness. Phase 6.7 decided this is not part of the
 * theme-author surface and stopped EXPORTING it; `flowcms/theme` is now a real
 * published artifact, so 7.2 stops SHIPPING it. Core runs these checks on a
 * theme at registry construction; a theme running them on itself would be a
 * second opinion about its own validity, and the registry's is the only one that
 * decides anything.
 *
 * The field TYPES and the limits still come from the contract — one definition
 * of what a setting is, validated here.
 */

import {
  MAX_FIELDS,
  MAX_SELECT_OPTIONS,
  MAX_SETTING_KEY_LENGTH,
  MAX_TEXT_LENGTH,
  type ThemeSettingField,
  type ThemeSettingsDefinition,
} from "@/Themes/contract/settings"

/** camelCase: starts lowercase, letters and digits after. One grammar, chosen
 *  because it matches how the keys are read in theme code (`settings.showTagline`). */
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/

/**
 * Keys that must never be accepted, whatever the grammar allows.
 *
 * Settings values are looked up by key. Even though resolution builds
 * null-prototype objects, refusing these outright means no future refactor can
 * turn a settings key into a prototype write.
 */
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"])

/** `#RGB`, `#RRGGBB`, `#RRGGBBAA` and nothing else — no named colours, no
 *  functional notation, no `var()`, no room for a second declaration. */
const COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export type DefinitionValidation =
  | { ok: true; definition: ThemeSettingsDefinition | null }
  | { ok: false; errors: string[] }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export function isSafeColor(value: unknown): value is string {
  return typeof value === "string" && COLOR_PATTERN.test(value)
}

function validateField(raw: unknown, index: number, errors: string[], seen: Set<string>): void {
  const where = `settings field #${index + 1}`

  if (!isPlainObject(raw)) {
    errors.push(`${where} must be an object`)
    return
  }

  const key = raw.key
  if (typeof key !== "string" || key.length === 0) {
    errors.push(`${where} needs a non-empty key`)
    return
  }
  if (key.length > MAX_SETTING_KEY_LENGTH) {
    errors.push(`Setting key "${key}" is longer than ${MAX_SETTING_KEY_LENGTH} characters`)
    return
  }
  if (RESERVED_KEYS.has(key)) {
    errors.push(`Setting key "${key}" is reserved and cannot be used`)
    return
  }
  if (!KEY_PATTERN.test(key)) {
    errors.push(`Setting key "${key}" must be camelCase: a lowercase letter, then letters or digits`)
    return
  }
  if (seen.has(key)) {
    errors.push(`Duplicate setting key "${key}"`)
    return
  }
  seen.add(key)

  if (typeof raw.label !== "string" || raw.label.trim() === "") {
    errors.push(`Setting "${key}" needs a label`)
  }
  if (raw.description !== undefined && typeof raw.description !== "string") {
    errors.push(`Setting "${key}" has a non-string description`)
  }
  if (!("default" in raw)) {
    errors.push(`Setting "${key}" needs a default`)
    return
  }

  const type = raw.type
  const fallback = raw.default

  // `options` only means something on a select. Accepting it elsewhere would
  // let a theme author believe a text field was constrained when it was not.
  if (type !== "select" && raw.options !== undefined) {
    errors.push(`Setting "${key}" is a ${String(type)} field and cannot declare options`)
  }

  switch (type) {
    case "text":
    case "textarea": {
      if (typeof fallback !== "string") {
        errors.push(`Setting "${key}" has a default that is not text`)
        break
      }
      const max = raw.maxLength
      if (max !== undefined) {
        if (!isFiniteNumber(max) || !Number.isInteger(max) || max < 1) {
          errors.push(`Setting "${key}" has an invalid maxLength`)
          break
        }
        if (max > MAX_TEXT_LENGTH) {
          errors.push(
            `Setting "${key}" asks for maxLength ${max}, above the FlowCMS maximum of ${MAX_TEXT_LENGTH}`,
          )
          break
        }
      }
      if (fallback.length > (max ?? MAX_TEXT_LENGTH)) {
        errors.push(`Setting "${key}" has a default longer than its own maximum`)
      }
      break
    }

    case "boolean":
      if (typeof fallback !== "boolean") {
        errors.push(`Setting "${key}" has a default that is not a boolean`)
      }
      break

    case "number": {
      if (!isFiniteNumber(fallback)) {
        errors.push(`Setting "${key}" has a default that is not a finite number`)
        break
      }
      const { min, max, step } = raw
      if (min !== undefined && !isFiniteNumber(min)) errors.push(`Setting "${key}" has a non-numeric min`)
      if (max !== undefined && !isFiniteNumber(max)) errors.push(`Setting "${key}" has a non-numeric max`)
      if (step !== undefined && (!isFiniteNumber(step) || step <= 0)) {
        errors.push(`Setting "${key}" has a step that is not a positive number`)
      }
      if (isFiniteNumber(min) && isFiniteNumber(max) && min > max) {
        errors.push(`Setting "${key}" has min greater than max`)
        break
      }
      if (isFiniteNumber(min) && fallback < min) errors.push(`Setting "${key}" default is below its min`)
      if (isFiniteNumber(max) && fallback > max) errors.push(`Setting "${key}" default is above its max`)
      break
    }

    case "select": {
      const options = raw.options
      if (!Array.isArray(options) || options.length === 0) {
        errors.push(`Setting "${key}" is a select and needs at least one option`)
        break
      }
      if (options.length > MAX_SELECT_OPTIONS) {
        errors.push(`Setting "${key}" declares more than ${MAX_SELECT_OPTIONS} options`)
        break
      }
      const values = new Set<string>()
      for (const option of options) {
        if (!isPlainObject(option) || typeof option.value !== "string" || typeof option.label !== "string") {
          errors.push(`Setting "${key}" has an option that is not { value, label }`)
          break
        }
        if (values.has(option.value)) {
          errors.push(`Setting "${key}" has duplicate option value "${option.value}"`)
          break
        }
        values.add(option.value)
      }
      if (typeof fallback !== "string" || !values.has(fallback)) {
        errors.push(`Setting "${key}" has a default that is not one of its options`)
      }
      break
    }

    case "color":
      if (!isSafeColor(fallback)) {
        errors.push(
          `Setting "${key}" has a default that is not a #RGB, #RRGGBB or #RRGGBBAA colour`,
        )
      }
      break

    default:
      errors.push(`Setting "${key}" has an unsupported type "${String(type)}"`)
  }
}

/**
 * Validate a theme's settings definition.
 *
 * `undefined` is valid and means the theme has no settings — most themes will
 * not, and forcing an empty definition on them would be noise.
 */
export function validateSettingsDefinition(raw: unknown): DefinitionValidation {
  if (raw === undefined || raw === null) return { ok: true, definition: null }

  const errors: string[] = []

  if (!isPlainObject(raw)) {
    return { ok: false, errors: ["Theme settings definition must be an object"] }
  }

  const version = raw.version
  if (!isFiniteNumber(version) || !Number.isInteger(version) || version < 1) {
    errors.push("Theme settings definition needs an integer version of 1 or more")
  }

  const fields = raw.fields
  if (!Array.isArray(fields)) {
    errors.push("Theme settings definition needs a fields array")
    return { ok: false, errors }
  }
  if (fields.length > MAX_FIELDS) {
    errors.push(`A theme may declare at most ${MAX_FIELDS} settings`)
  }

  const seen = new Set<string>()
  fields.forEach((field, index) => validateField(field, index, errors, seen))

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    definition: { version: version as number, fields: fields as ThemeSettingField[] },
  }
}

