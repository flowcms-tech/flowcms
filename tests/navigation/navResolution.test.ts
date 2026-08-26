import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { resolveMenuHrefs, type MenuItemRecord, type EntityIndex } from "@/Modules/Public/ViewModels/navResolve"

/**
 * Turning stored menu rows into hrefs.
 *
 * Split out from the query layer so it can be tested with no database at all:
 * the queries fetch entities, this decides what each item points at, and
 * `buildNavTree` decides what renders. Each piece is provable on its own.
 */

const EMPTY: EntityIndex = { pages: new Map(), posts: new Map(), categories: new Map(), tags: new Map() }

function row(over: Partial<MenuItemRecord> & { id: string }): MenuItemRecord {
  return {
    menuId: "m1",
    parentId: null,
    label: over.id,
    type: "custom",
    target: "/x",
    sortOrder: 0,
    isActive: true,
    opensInNewTab: false,
    ...over,
  }
}

describe("resolveMenuHrefs — custom targets", () => {
  it("passes a safe path through", () => {
    const [item] = resolveMenuHrefs([row({ id: "a", type: "custom", target: "/about" })], EMPTY)
    expect(item.href).toBe("/about")
  })

  it("resolves an unsafe target to null rather than rendering it", () => {
    const [item] = resolveMenuHrefs(
      [row({ id: "a", type: "custom", target: "javascript:alert(1)" })],
      EMPTY,
    )
    expect(item.href).toBeNull()
  })
})

describe("resolveMenuHrefs — entity targets", () => {
  const index: EntityIndex = {
    pages: new Map([["page-1", "/privacy"]]),
    posts: new Map([["post-1", "hello-world"]]),
    categories: new Map([["cat-1", "guides"]]),
    tags: new Map([["tag-1", "how-to"]]),
  }

  it("resolves a page to its current path", () => {
    const [item] = resolveMenuHrefs([row({ id: "a", type: "page", target: "page-1" })], index)
    expect(item.href).toBe("/privacy")
  })

  it("resolves a post to its current slug, not a stored copy of the URL", () => {
    const [item] = resolveMenuHrefs([row({ id: "a", type: "post", target: "post-1" })], index)
    expect(item.href).toBe("/blog/hello-world")
  })

  it("resolves a category archive", () => {
    const [item] = resolveMenuHrefs([row({ id: "a", type: "category", target: "cat-1" })], index)
    expect(item.href).toBe("/blog/category/guides")
  })

  it("resolves a tag archive", () => {
    const [item] = resolveMenuHrefs([row({ id: "a", type: "tag", target: "tag-1" })], index)
    expect(item.href).toBe("/blog/tag/how-to")
  })

  it("resolves a missing entity to null, for every entity type", () => {
    for (const type of ["page", "post", "category", "tag"] as const) {
      const [item] = resolveMenuHrefs([row({ id: "a", type, target: "gone" })], index)
      expect(item.href, type).toBeNull()
    }
  })

  it("keeps the row so the admin can still show the broken reference", () => {
    const items = resolveMenuHrefs([row({ id: "a", type: "post", target: "gone" })], index)
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe("a")
  })
})

describe("ThemeShell no longer hardcodes an empty nav", () => {
  const shell = readFileSync(
    join(process.cwd(), "src", "Modules", "Public", "Components", "ThemeShell.tsx"),
    "utf8",
  )

  it("has no EMPTY_NAV constant left", () => {
    // The 6.1 placeholder. Leaving it behind would mean navigation silently
    // never appears while every test about menus still passed.
    expect(shell).not.toMatch(/EMPTY_NAV/)
  })

  it("builds the nav from the rendering theme's declared slots", () => {
    expect(shell).toMatch(/getNavView/)
    expect(shell).toMatch(/resolveLayoutAndSlots/)
  })

  it("does not query menu tables itself", () => {
    // The shell composes; it does not read. Keeping the query in one place is
    // what stops eight public routes from each growing their own menu read.
    expect(shell).not.toMatch(/@\/db/)
  })
})

describe("public render routes do not each acquire menu queries", () => {
  /**
   * The PUBLIC surface only. `src/app/api/appearance/menus/**` reads and writes
   * menu tables — that is what those routes are for — and `admin-panel` renders
   * the editor. What must not happen is a public page fetching its own
   * navigation, because it would then render a different menu from the shell
   * wrapped around it and neither would look wrong.
   */
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry)
      return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(full) ? [full] : []
    })

  const publicRoutes = walk(join(process.cwd(), "src", "app")).filter((file) => {
    const rel = file.split("\\").join("/")
    return !rel.includes("/src/app/api/") && !rel.includes("/src/app/admin-panel/")
  })

  it("finds public route files to check", () => {
    expect(publicRoutes.length).toBeGreaterThan(5)
  })

  it("no public route builds its own navigation", () => {
    const offenders = publicRoutes.filter((file) =>
      /ViewModels\/nav|getNavView|db\/schema\/menus/.test(readFileSync(file, "utf8")),
    )
    expect(offenders).toEqual([])
  })
})
