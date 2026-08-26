import { defineThemeSettings, type ThemeSettingsOf } from "@/Themes/contract"

/**
 * What an operator can change about the default theme.
 *
 * DELIBERATELY SMALL. Three presentation controls, not a configuration panel
 * built to exercise every field type. Each one is generic, presentation-only,
 * and owns no SEO meaning:
 *
 *   - `showTagline` hides a line of decorative text that appears nowhere in
 *     structured data, so hiding it cannot make the rendered page disagree with
 *     what JSON-LD claims about the site.
 *   - `layoutWidth` changes a container width. Nothing but CSS.
 *   - `accentColor` tints links and rules, through a CSS custom property core
 *     has already validated as a colour.
 *
 * THE DEFAULTS REPRODUCE PHASE 6.5's APPEARANCE EXACTLY. A fresh install must
 * not look different because settings support was added, which is why
 * `showTagline` defaults to false: the 6.1 Layout never rendered a tagline.
 */
export const defaultThemeSettings = defineThemeSettings({
  version: 1,
  fields: [
    {
      key: "showTagline",
      type: "boolean",
      label: "Show the site tagline",
      description:
        "Displays the tagline from Settings under the site name. Off by default, matching how the theme looked before this setting existed.",
      default: false,
    },
    {
      key: "layoutWidth",
      type: "select",
      label: "Content width",
      description: "How wide the main column is on large screens.",
      default: "normal",
      options: [
        { value: "narrow", label: "Narrow" },
        { value: "normal", label: "Normal" },
        { value: "wide", label: "Wide" },
      ],
    },
    {
      key: "accentColor",
      type: "color",
      label: "Accent colour",
      description: "Used for links and small highlights. Hex only, e.g. #3366ff.",
      default: "#2563eb",
    },
  ],
})

export type DefaultThemeSettings = ThemeSettingsOf<typeof defaultThemeSettings>

/** Tailwind's arbitrary values cannot take a runtime string, so the select maps
 *  to a fixed class. A lookup keeps the rendered class list a closed set — an
 *  operator value never becomes part of a class name. */
export const LAYOUT_WIDTH_CLASS: Record<string, string> = {
  narrow: "max-w-3xl",
  normal: "max-w-6xl",
  wide: "max-w-7xl",
}
