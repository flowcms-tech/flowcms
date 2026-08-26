import { defineThemeSettings, type ThemeSettingsOf } from "flowcms/theme"

/**
 * Aurora's operator-configurable settings.
 *
 * DECLARATIVE METADATA, not React. FlowCMS renders the admin form from this; a
 * theme cannot supply admin UI, and does not need to.
 *
 * `version: 2` is the shape of the PERSISTED settings — bumped once when
 * `accent` replaced an earlier field. It is not the package version (1.2.0) and
 * not the FlowCMS compatibility range (^0.1.0).
 */
export const auroraSettings = defineThemeSettings({
  version: 2,
  fields: [
    {
      key: "showAurora",
      type: "boolean",
      label: "Show the Aurora banner",
      description: "A small banner above the site name.",
      default: true,
    },
    {
      key: "headingStyle",
      type: "select",
      label: "Heading style",
      default: "plain",
      options: [
        { value: "plain", label: "Plain" },
        { value: "loud", label: "Loud" },
      ],
    },
    {
      key: "bannerText",
      type: "text",
      label: "Banner text",
      description: "Shown in the banner when it is visible.",
      default: "Aurora",
      maxLength: 60,
    },
  ],
})

export type AuroraSettings = ThemeSettingsOf<typeof auroraSettings>
