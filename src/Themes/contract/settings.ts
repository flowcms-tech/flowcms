/**
 * Theme settings: what a theme DECLARES, and what core does with it.
 *
 * A theme ships a declarative definition — metadata, not React. Core owns the
 * admin form, the validation, the storage and the resolution. That split is the
 * whole design:
 *
 *   the DEFINITION belongs to trusted theme source code;
 *   the VALUES belong to the database and are operator input.
 *
 * A theme executes with the privileges of the FlowCMS server and no sandbox is
 * claimed. This module does not pretend otherwise. It validates the declarative
 * definition so that a MISTAKE in a theme fails predictably — at registry
 * construction, making that theme unavailable — instead of when an operator
 * opens the settings page. And it validates operator VALUES, which are
 * genuinely untrusted, on the way in and again on the way out.
 *
 * PURE AND DEPENDENCY-FREE. No database, no React, no Zod, and after Phase 7.2
 * no imports at all: this file is compiled verbatim into the published
 * `flowcms` package, so anything it reaches for a theme author has to install
 * too.
 *
 * The VALIDATION of a definition lives in `src/Themes/validation/`, not here.
 * Phase 6.7 stopped exporting it to theme authors; 7.2 stopped shipping it to
 * them, which is the same decision carried one step further now that the
 * contract is a real package rather than a path alias.
 */

// -- Limits -------------------------------------------------------------------

/** Core's absolute ceiling for any text-like value. A theme may declare a
 *  stricter `maxLength`; it may not ask for more. */
export const MAX_TEXT_LENGTH = 4000
export const MAX_SETTING_KEY_LENGTH = 48
/** Bounded so a definition cannot become an admin screen nobody can use. */
export const MAX_FIELDS = 40
export const MAX_SELECT_OPTIONS = 60

// -- Field definitions --------------------------------------------------------

export type ThemeSettingFieldType =
  | "text"
  | "textarea"
  | "boolean"
  | "number"
  | "select"
  | "color"

interface FieldBase {
  key: string
  label: string
  description?: string
}

export interface TextField extends FieldBase {
  type: "text" | "textarea"
  default: string
  placeholder?: string
  /** Stricter than `MAX_TEXT_LENGTH`, never looser. */
  maxLength?: number
}

export interface BooleanField extends FieldBase {
  type: "boolean"
  default: boolean
}

export interface NumberField extends FieldBase {
  type: "number"
  default: number
  min?: number
  max?: number
  step?: number
}

export interface SelectOption {
  value: string
  label: string
}

export interface SelectField extends FieldBase {
  type: "select"
  default: string
  options: SelectOption[]
}

export interface ColorField extends FieldBase {
  type: "color"
  /** `#RGB`, `#RRGGBB` or `#RRGGBBAA`. */
  default: string
}

export type ThemeSettingField = TextField | BooleanField | NumberField | SelectField | ColorField

export interface ThemeSettingsDefinition {
  /**
   * The shape of this theme's persisted settings — a positive integer, NOT the
   * theme's semver. It changes when the fields change in a way that matters to
   * stored rows, and it is persisted alongside the values so core can tell an
   * old row from a current one without guessing.
   */
  version: number
  fields: ThemeSettingField[]
}

/** What a theme component receives. Never `any`. */
export type ThemeSettingValue = string | number | boolean
export type ThemeSettingsValues = Readonly<Record<string, ThemeSettingValue>>

// -- Author-facing helpers ----------------------------------------------------

/**
 * Declare a theme's settings.
 *
 * Identity at runtime; its job is inference. `const` type parameters preserve
 * the literal field keys and types, so `ThemeSettingsOf<typeof mySettings>`
 * gives a theme author `{ showTagline: boolean; heading: string }` rather than
 * an index signature — which is what makes `settings.showTagline` type-check
 * as a boolean inside a component.
 */
export function defineThemeSettings<const D extends ThemeSettingsDefinition>(definition: D): D {
  return definition
}

/** The value type a field produces. */
type ValueOfField<F> = F extends { type: "boolean" }
  ? boolean
  : F extends { type: "number" }
    ? number
    : F extends { type: "select"; options: ReadonlyArray<{ value: infer V }> }
      ? V extends string
        ? V
        : string
      : string

/**
 * The resolved settings object for a definition.
 *
 * Falls back to the open `ThemeSettingsValues` when a definition is not a
 * literal — a theme that passes a widened definition still gets a usable type,
 * just not per-key inference.
 */
export type ThemeSettingsOf<D> = D extends { fields: ReadonlyArray<infer F> }
  ? // `[F] extends [...]` rather than `F extends ...`: a bare conditional
    // DISTRIBUTES over the union of field types and would produce a union of
    // single-key objects — `{showTagline} | {layoutWidth}` — where reading any
    // one key fails. The tuple wrapper turns off distribution so the mapped
    // type sees every key at once.
    [F] extends [{ key: string }]
    ? { readonly [K in F["key"]]: ValueOfField<Extract<F, { key: K }>> }
    : ThemeSettingsValues
  : ThemeSettingsValues

/**
 * Read a theme's own settings with its own types.
 *
 * The registry stores every surface as `ComponentType<ThemeSurfaceProps<V>>`
 * with the OPEN settings type, deliberately: making `FlowCMSTheme` generic in
 * each theme's settings would push a type parameter through the registry, the
 * resolver and every dispatch site to buy inference that only theme components
 * use. So the narrowing happens where it is needed instead:
 *
 *     const s = themeSettingsOf(settingsDefinition, settings)
 *     s.showTagline  // boolean, not unknown
 *
 * THE ONE CAST IN THE THEME-FACING API, and it is sound rather than convenient:
 * core resolves values from this exact definition, guarantees a value for every
 * declared field, guarantees each value's type matches its field, and drops
 * everything else. The assertion restates an invariant the resolver enforces at
 * runtime and `tests/themes/settingsResolution.test.ts` pins. It is encapsulated
 * here so no theme ever writes a cast of its own.
 *
 * Identity at runtime — it costs nothing and returns the same object.
 */
export function themeSettingsOf<const D extends ThemeSettingsDefinition>(
  _definition: D,
  values: ThemeSettingsValues,
): ThemeSettingsOf<D> {
  return values as ThemeSettingsOf<D>
}
