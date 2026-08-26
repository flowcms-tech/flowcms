import { isSafeColor } from "@/Themes/validation/settingsDefinition"
import {
  MAX_TEXT_LENGTH,
  type ThemeSettingField,
  type ThemeSettingValue,
  type ThemeSettingsDefinition,
  type ThemeSettingsValues,
} from "@/Themes/contract/settings"

/**
 * Resolving a stored row into the values a theme renders from.
 *
 * PURE. It takes the definition and the row as arguments rather than reading a
 * database, so every state an operator can end up in — an old schema version, a
 * value whose select option was removed, hand-edited JSON — is constructible in
 * a test without one.
 *
 * THE READ PATH IS RESILIENT, and deliberately so. Its contract is that it
 * always returns a complete, correctly-typed settings object. What it will not
 * do is WRITE: repairing the row here would destroy an operator's stored intent
 * silently, from a render path, on a GET. Issues are reported to the admin
 * instead.
 *
 * A CORRUPT ROW IS NOT A DATABASE OUTAGE. This function only ever sees rows
 * that were read successfully. An unreachable database throws in the query
 * layer and propagates, because "the database is down" and "this JSON is
 * malformed" need different responses and conflating them would hide an
 * outage behind a page that looks fine.
 */

/** Ceiling for the serialised values, enforced on write. Large enough for any
 *  reasonable presentation config, small enough that a row cannot become a
 *  content store. */
export const MAX_SETTINGS_BYTES = 16 * 1024

export type ThemeSettingsIssueKind =
  | "corrupt-json"
  | "version-mismatch"
  | "invalid-value"
  | "unknown-key"

export interface ThemeSettingsIssue {
  kind: ThemeSettingsIssueKind
  /** The setting key this concerns, when it concerns one. */
  field?: string
  /** Operator-facing. Never contains the stored value: a row is operator data
   *  and may be anything, and an issue list is rendered in the admin. */
  message: string
}

export interface ResolvedThemeSettings {
  themeSlug: string
  /** Complete and correctly typed: every declared field, always. Null-prototype. */
  values: ThemeSettingsValues
  /** Whether a row exists at all. False is the ordinary fresh-install state. */
  stored: boolean
  /** The version recorded on the row, or null when there is no row. */
  schemaVersion: number | null
  /** The version the installed theme declares, or null when it has no settings. */
  definitionVersion: number | null
  /** Stored keys the definition no longer declares. Kept so the write path can
   *  carry them forward instead of destroying an older or newer theme's data. */
  unknownValues: Record<string, unknown>
  issues: ThemeSettingsIssue[]
}

/**
 * Validate one stored value against its field.
 *
 * Returns the value to use, or `undefined` when the stored value is unusable —
 * the caller then falls back to the field's default and records an issue.
 * Exported because the WRITE path applies exactly these rules, so a value the
 * admin accepts is by construction a value the renderer will accept.
 */
export function coerceSettingValue(
  field: ThemeSettingField,
  raw: unknown,
): ThemeSettingValue | undefined {
  switch (field.type) {
    case "text":
    case "textarea": {
      if (typeof raw !== "string") return undefined
      const max = Math.min(field.maxLength ?? MAX_TEXT_LENGTH, MAX_TEXT_LENGTH)
      return raw.length > max ? undefined : raw
    }

    case "boolean":
      // Strictly a boolean. Accepting "true"/1 would make the stored shape
      // depend on which client wrote it.
      return typeof raw === "boolean" ? raw : undefined

    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined
      if (field.min !== undefined && raw < field.min) return undefined
      if (field.max !== undefined && raw > field.max) return undefined
      return raw
    }

    case "select":
      // The stored value is an option VALUE, never a label. A value whose
      // option a theme update removed is not silently kept.
      return typeof raw === "string" && field.options.some((o) => o.value === raw)
        ? raw
        : undefined

    case "color":
      return isSafeColor(raw) ? raw : undefined
  }
}

function describeInvalid(field: ThemeSettingField): string {
  switch (field.type) {
    case "select":
      return `The saved value for "${field.label}" is no longer one of the available options. The theme default is being used.`
    case "color":
      return `The saved colour for "${field.label}" is not a valid #RRGGBB value. The theme default is being used.`
    case "number":
      return `The saved value for "${field.label}" is outside the allowed range. The theme default is being used.`
    default:
      return `The saved value for "${field.label}" is not valid. The theme default is being used.`
  }
}

/** Parse the stored JSON into a plain record, or null when it is unusable. */
function parseStored(json: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  // Arrays and primitives are as unusable as a parse failure — a settings row
  // is an object of keys or it is corrupt.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}

/**
 * Only keys the object OWNS, and never the prototype-sensitive ones.
 *
 * `JSON.parse` puts a literal `__proto__` key on the parsed object as an own
 * property rather than mutating a prototype, so this is defence in depth — but
 * the resolved object is also built with a null prototype, so neither a lookup
 * nor an assignment can walk a chain.
 */
const RESERVED = new Set(["__proto__", "constructor", "prototype"])

function ownEntries(source: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(Object.getOwnPropertyDescriptors(source))
    .filter(([key]) => !RESERVED.has(key))
    .map(([key, descriptor]) => [key, descriptor.value] as [string, unknown])
}

export interface ThemeSettingsRow {
  values: string
  schemaVersion: number
}

export function resolveSettingsRow(input: {
  themeSlug: string
  definition: ThemeSettingsDefinition | null
  row: ThemeSettingsRow | null
}): ResolvedThemeSettings {
  const { themeSlug, definition, row } = input
  const issues: ThemeSettingsIssue[] = []

  // Null prototype: nothing a stored key can be named lets a later lookup reach
  // `Object.prototype`.
  const values = Object.create(null) as Record<string, ThemeSettingValue>
  const unknownValues: Record<string, unknown> = Object.create(null)

  if (!definition) {
    // A theme with no settings still resolves — to nothing. Callers do not
    // special-case it, and a row left over from a previous version of the theme
    // is preserved rather than surfaced as a broken value.
    return {
      themeSlug,
      values,
      stored: row !== null,
      schemaVersion: row?.schemaVersion ?? null,
      definitionVersion: null,
      unknownValues,
      issues,
    }
  }

  for (const field of definition.fields) values[field.key] = field.default

  if (!row) {
    return {
      themeSlug,
      values,
      stored: false,
      schemaVersion: null,
      definitionVersion: definition.version,
      unknownValues,
      issues,
    }
  }

  const parsed = parseStored(row.values)
  if (!parsed) {
    issues.push({
      kind: "corrupt-json",
      message:
        "The saved settings for this theme could not be read and every field is using its theme default. Saving from this screen will replace them.",
    })
    return {
      themeSlug,
      values,
      stored: true,
      schemaVersion: row.schemaVersion,
      definitionVersion: definition.version,
      unknownValues,
      issues,
    }
  }

  if (row.schemaVersion !== definition.version) {
    // Reported, not repaired. The values below are still resolved field by
    // field, so an older row keeps everything the current definition can use.
    issues.push({
      kind: "version-mismatch",
      message: `These settings were saved for version ${row.schemaVersion} of this theme's settings; the installed theme declares version ${definition.version}. Values that still apply are in use; the rest are using theme defaults.`,
    })
  }

  const declared = new Map(definition.fields.map((field) => [field.key, field]))

  for (const [key, raw] of ownEntries(parsed)) {
    const field = declared.get(key)
    if (!field) {
      // Kept in `unknownValues` so a save can carry it forward: a key this
      // build does not know may belong to a newer theme version an operator is
      // about to reinstall, and dropping it would be data loss by upgrade.
      unknownValues[key] = raw
      issues.push({
        kind: "unknown-key",
        field: key,
        message: `The saved settings contain "${key}", which this version of the theme no longer uses. It is being kept but not applied.`,
      })
      continue
    }

    const coerced = coerceSettingValue(field, raw)
    if (coerced === undefined) {
      issues.push({ kind: "invalid-value", field: key, message: describeInvalid(field) })
      continue
    }
    values[key] = coerced
  }

  return {
    themeSlug,
    values,
    stored: true,
    schemaVersion: row.schemaVersion,
    definitionVersion: definition.version,
    unknownValues,
    issues,
  }
}
