import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import {
  canManageAppearance,
  canManageMenus,
  ROLES,
  type Role,
} from "@/Framework/Auth/permissions"
import { ROUTE_POLICIES, resolveRouteAccess } from "@/Framework/Auth/routePolicies"
import {
  ACTIVITY_ENTITY_TYPES,
  ACTIVITY_ENTITY_LABELS,
  activityEntityHref,
} from "@/Framework/Activity/activityTypes"
import { coerceSettingValue } from "@/Framework/Settings/themeSettingsResolve"
import { defaultThemeSettings } from "@/Themes/default/settings"
import { defaultTheme } from "@/Themes/default"
import type { ThemeSettingField } from "@/Themes/contract/settings"

/**
 * Who may configure a theme, and what an operator's values can and cannot do.
 *
 * Theme settings change how every public page looks, so they sit at the same
 * threshold as theme activation — ADMIN — and deliberately not at the menu
 * threshold. A menu is content navigation an editor curates; a theme's
 * appearance is site configuration.
 */

describe("authorization", () => {
  it("is admin and above, refusing editor and contributor", () => {
    const expected: Record<Role, boolean> = {
      owner: true,
      admin: true,
      editor: false,
      contributor: false,
    }
    for (const role of ROLES) expect(canManageAppearance(role), role).toBe(expected[role])
  })

  it("is deliberately STRICTER than the menu threshold", () => {
    // If these ever collapse into one predicate, one of the two decisions was
    // made by accident.
    expect(canManageMenus("editor")).toBe(true)
    expect(canManageAppearance("editor")).toBe(false)
  })
})

describe("route policy", () => {
  const path = "appearance/theme-settings"

  it("is declared", () => {
    expect(ROUTE_POLICIES[path]).toBeDefined()
  })

  it("gates every verb at admin, reads included", () => {
    for (const method of ["GET", "PUT", "DELETE"] as const) {
      expect(resolveRouteAccess(`/api/${path}`, method)?.access, method).toBe("admin")
    }
  })

  it("is not public and records a real reason", () => {
    expect(ROUTE_POLICIES[path].default).not.toBe("public")
    expect(ROUTE_POLICIES[path].reason.length).toBeGreaterThan(40)
  })
})

describe("the handler enforces the role itself, not only the policy floor", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/appearance/theme-settings/route.ts"),
    "utf8",
  )

  it("calls requireApiAuth and canManageAppearance once per verb", () => {
    const verbs = [...source.matchAll(/export async function (GET|PUT|DELETE)\(/g)]
    expect(verbs).toHaveLength(3)
    expect((source.match(/requireApiAuth\(/g) ?? []).length).toBe(3)
    expect((source.match(/canManageAppearance\(/g) ?? []).length).toBe(3)
  })

  it("never activates a theme", () => {
    // Configuring a theme must not switch to it. Checked against CODE rather
    // than the whole file: the module comment explains this rule and says
    // `settings.activeTheme` while doing so, and a guard that a comment can
    // trip is a guard people learn to work around.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
    expect(code).not.toMatch(/setActiveTheme\s*\(|clearActiveTheme\s*\(/)
    expect(code).not.toMatch(/activeTheme/)
  })

  it("leaks no database error, stack trace or stored JSON", () => {
    expect(source).not.toMatch(/\.stack/)
    expect(source).not.toMatch(/settingsJson/)
    expect(source).not.toMatch(/message:\s*(?:String\()?\w*(?:error|err|e)\.message/i)
  })

  it("logs field names, never field values", () => {
    // The activity log has a wider audience than this screen, and a settings
    // value is free-form operator text.
    expect(source).toMatch(/fields: changedFields/)
    expect(source).not.toMatch(/metadata:\s*\{[^}]*values/)
  })
})

describe("activity vocabulary", () => {
  it("has an entity type for theme settings", () => {
    expect(ACTIVITY_ENTITY_TYPES).toContain("theme_settings")
    expect(ACTIVITY_ENTITY_LABELS.theme_settings).toBeTruthy()
  })

  it("links to the Theme Settings screen, admin-relative", () => {
    expect(activityEntityHref("theme_settings", "default")).toBe("/appearance/theme-settings")
    expect(activityEntityHref("theme_settings", "default")?.startsWith("/admin")).toBe(false)
  })
})

describe("operator values are untrusted data", () => {
  const field = (key: string): ThemeSettingField => {
    const found = defaultThemeSettings.fields.find((f) => f.key === key)
    if (!found) throw new Error(`no field ${key}`)
    return found
  }

  it.each([
    "#fff; background-image: url(https://evil.test/x)",
    "url(https://evil.test/x)",
    "expression(alert(1))",
    "var(--anything)",
    "red",
    "rgb(1,2,3)",
    "#fff onload=alert(1)",
    "javascript:alert(1)",
  ])("refuses the CSS payload %s in a colour field", (value) => {
    expect(coerceSettingValue(field("accentColor"), value)).toBeUndefined()
  })

  it("refuses a select value that is not one of the declared options", () => {
    expect(coerceSettingValue(field("layoutWidth"), "'; drop table --")).toBeUndefined()
    expect(coerceSettingValue(field("layoutWidth"), "wide")).toBe("wide")
  })

  it("refuses a non-boolean for a boolean field", () => {
    for (const value of ["true", 1, null, {}]) {
      expect(coerceSettingValue(field("showTagline"), value)).toBeUndefined()
    }
  })
})

describe("text settings are escaped when rendered", () => {
  const BRAND = { siteName: "FlowCMS", tagline: null, logoUrl: null, logoAltText: null }
  const NAV = { slots: {} }

  it("does not emit an operator's script tag as markup", () => {
    // A theme is trusted code; an operator's value is not. React escapes text
    // children, and no theme uses dangerouslySetInnerHTML for a setting.
    const hostile = '<script>alert(1)</script>'
    const html = renderToStaticMarkup(
      <defaultTheme.Layout
        brand={{ ...BRAND, tagline: hostile }}
        nav={NAV}
        settings={{ showTagline: true, layoutWidth: "normal", accentColor: "#2563eb" }}
      >
        <p>body</p>
      </defaultTheme.Layout>,
    )
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("no theme renders a setting through dangerouslySetInnerHTML", () => {
    // `PageView.html` is core-sanitised content and is allowed to use it; a
    // SETTING never may. This checks the settings objects specifically.
    const themeFiles = [
      "src/Themes/default/Layout.tsx",
      "src/Themes/integration/theme.tsx",
      "packages/flowcms-theme-aurora/src/Layout.tsx",
    ]
    for (const file of themeFiles) {
      const source = readFileSync(join(process.cwd(), file), "utf8")
      expect(source, file).not.toMatch(/dangerouslySetInnerHTML/)
    }
  })
})

describe("the admin form is core-owned", () => {
  it("renders from metadata, never from theme-supplied React", () => {
    const form = readFileSync(
      join(process.cwd(), "src/Modules/Appearance/Components/ThemeSettingsForm.tsx"),
      "utf8",
    )
    // No dynamic component resolution, no eval, no HTML injection.
    expect(form).not.toMatch(/dangerouslySetInnerHTML/)
    expect(form).not.toMatch(/createElement\(\s*[a-z]/)
    expect(form).not.toMatch(/\bnew Function\b|\beval\(/)
  })

  it("sends no registry internals to the browser", () => {
    const view = readFileSync(
      join(process.cwd(), "src/Modules/Appearance/Queries/themeSettingsAdminQueries.ts"),
      "utf8",
    )
    // The view model names fields and values; it must not spread a theme.
    expect(view).not.toMatch(/\.\.\.entry\.theme|theme:\s*entry\.theme/)
  })
})
