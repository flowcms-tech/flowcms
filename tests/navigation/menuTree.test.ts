import { describe, expect, it } from "vitest"
import {
  buildNavTree,
  resequence,
  validateParentPlacement,
  type ResolvedMenuItem,
} from "@/Framework/Navigation/menuTree"

/**
 * The tree rules, on both sides of the boundary.
 *
 * `buildNavTree` is the PUBLIC path and it is deliberately forgiving: it is
 * handed whatever the database holds, including rows written by an older
 * version or edited by hand, and its contract is that it always returns a
 * renderable tree and always terminates. It drops what it cannot place; it
 * never throws and never promotes an orphan into a position its operator did
 * not choose.
 *
 * `validateParentPlacement` is the MUTATION path and it is strict: it refuses
 * to create the states `buildNavTree` has to tolerate. Same asymmetry as
 * `setActiveTheme` / `resolveTheme`.
 */

const MENU = "menu-1"

function item(over: Partial<ResolvedMenuItem> & { id: string }): ResolvedMenuItem {
  return {
    menuId: MENU,
    parentId: null,
    label: over.id,
    href: `/${over.id}`,
    sortOrder: 0,
    isActive: true,
    opensInNewTab: false,
    ...over,
  }
}

describe("buildNavTree — structure", () => {
  it("returns top-level items with their children nested", () => {
    const tree = buildNavTree([
      item({ id: "parent", sortOrder: 0 }),
      item({ id: "child", parentId: "parent", sortOrder: 0 }),
    ])

    expect(tree).toEqual([
      {
        label: "parent",
        href: "/parent",
        opensInNewTab: false,
        children: [{ label: "child", href: "/child", opensInNewTab: false, children: [] }],
      },
    ])
  })

  it("gives every item an empty children array, so a theme never checks for undefined", () => {
    const [only] = buildNavTree([item({ id: "solo" })])
    expect(only.children).toEqual([])
  })

  it("carries opensInNewTab through", () => {
    const [only] = buildNavTree([item({ id: "solo", opensInNewTab: true })])
    expect(only.opensInNewTab).toBe(true)
  })
})

describe("buildNavTree — depth", () => {
  it("drops a grandchild rather than flattening it into the tree", () => {
    // Flattening would silently promote a link the operator put two levels
    // down into the top-level bar. Dropping is visible and reversible.
    const tree = buildNavTree([
      item({ id: "a" }),
      item({ id: "b", parentId: "a" }),
      item({ id: "c", parentId: "b" }),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0].children.map((c) => c.label)).toEqual(["b"])
    expect(tree[0].children[0].children).toEqual([])
  })
})

describe("buildNavTree — corrupt data cannot hang the public site", () => {
  it("terminates and renders nothing for a two-item cycle", () => {
    const tree = buildNavTree([
      item({ id: "a", parentId: "b" }),
      item({ id: "b", parentId: "a" }),
    ])
    // Neither is top-level, so neither is a root, so nothing renders. The
    // builder makes two passes and never follows a parent pointer, so a cycle
    // of any length costs the same as no cycle at all.
    expect(tree).toEqual([])
  })

  it("terminates for a self-parenting row", () => {
    expect(buildNavTree([item({ id: "a", parentId: "a" })])).toEqual([])
  })

  it("terminates for a long cycle", () => {
    const rows = Array.from({ length: 500 }, (_, i) =>
      item({ id: `n${i}`, parentId: `n${(i + 1) % 500}` }),
    )
    expect(buildNavTree(rows)).toEqual([])
  })

  it("drops an item whose parent does not exist", () => {
    expect(buildNavTree([item({ id: "orphan", parentId: "ghost" })])).toEqual([])
  })

  it("drops a child whose parent belongs to a different menu", () => {
    // The builder is normally handed one menu's rows, so this is the shape a
    // corrupt `parentId` takes: the named parent exists, but not here.
    const tree = buildNavTree([item({ id: "mine" }), item({ id: "child", parentId: "elsewhere" })])
    expect(tree.map((n) => n.label)).toEqual(["mine"])
    expect(tree[0].children).toEqual([])
  })

  it("refuses to nest across menus even when both menus' rows are present", () => {
    // Belt and braces: if a caller ever passes a mixed set, a `menu-1` child
    // must not attach itself to a `menu-2` parent. Both top-level rows still
    // render as roots of their own menus; the cross-menu child does not.
    const tree = buildNavTree([
      item({ id: "mine" }),
      item({ id: "theirs", menuId: "menu-2" }),
      item({ id: "child", parentId: "theirs" }),
    ])
    expect(tree.map((n) => n.label).sort()).toEqual(["mine", "theirs"])
    expect(tree.flatMap((n) => n.children)).toEqual([])
  })
})

describe("buildNavTree — visibility", () => {
  it("omits an inactive item", () => {
    const tree = buildNavTree([item({ id: "shown" }), item({ id: "hidden", isActive: false })])
    expect(tree.map((n) => n.label)).toEqual(["shown"])
  })

  it("omits the children of an inactive parent, rather than promoting them", () => {
    const tree = buildNavTree([
      item({ id: "parent", isActive: false }),
      item({ id: "child", parentId: "parent" }),
    ])
    expect(tree).toEqual([])
  })

  it("omits an item whose href could not be resolved", () => {
    // A deleted post, an unpublished page: core resolves the href to null and
    // the item simply does not appear. It stays in the admin, where it can be
    // fixed or removed.
    const tree = buildNavTree([item({ id: "ok" }), item({ id: "broken", href: null })])
    expect(tree.map((n) => n.label)).toEqual(["ok"])
  })

  it("omits the children of an item whose href could not be resolved", () => {
    const tree = buildNavTree([
      item({ id: "broken", href: null }),
      item({ id: "child", parentId: "broken" }),
    ])
    expect(tree).toEqual([])
  })
})

describe("buildNavTree — ordering is total", () => {
  it("orders by sortOrder ascending", () => {
    const tree = buildNavTree([
      item({ id: "third", sortOrder: 30 }),
      item({ id: "first", sortOrder: 10 }),
      item({ id: "second", sortOrder: 20 }),
    ])
    expect(tree.map((n) => n.label)).toEqual(["first", "second", "third"])
  })

  it("breaks a sortOrder tie on label, so equal values still render deterministically", () => {
    const tree = buildNavTree([
      item({ id: "b", label: "Beta", sortOrder: 0 }),
      item({ id: "a", label: "Alpha", sortOrder: 0 }),
    ])
    expect(tree.map((n) => n.label)).toEqual(["Alpha", "Beta"])
  })

  it("breaks a label tie on id, so ordering never depends on row order", () => {
    const forwards = buildNavTree([
      item({ id: "zzz", label: "Same" }),
      item({ id: "aaa", label: "Same" }),
    ])
    const backwards = buildNavTree([
      item({ id: "aaa", label: "Same" }),
      item({ id: "zzz", label: "Same" }),
    ])
    expect(forwards.map((n) => n.href)).toEqual(["/aaa", "/zzz"])
    expect(forwards).toEqual(backwards)
  })

  it("orders children by the same rule", () => {
    const tree = buildNavTree([
      item({ id: "p" }),
      item({ id: "c2", parentId: "p", sortOrder: 20 }),
      item({ id: "c1", parentId: "p", sortOrder: 10 }),
    ])
    expect(tree[0].children.map((c) => c.label)).toEqual(["c1", "c2"])
  })
})

describe("validateParentPlacement", () => {
  const existing = [
    { id: "top", menuId: MENU, parentId: null },
    { id: "child", menuId: MENU, parentId: "top" },
    { id: "elsewhere", menuId: "menu-2", parentId: null },
  ]

  it("accepts a top-level placement", () => {
    expect(
      validateParentPlacement({ itemId: null, menuId: MENU, parentId: null, existing }),
    ).toEqual({ ok: true })
  })

  it("accepts a child of a top-level item in the same menu", () => {
    expect(
      validateParentPlacement({ itemId: null, menuId: MENU, parentId: "top", existing }),
    ).toEqual({ ok: true })
  })

  it("rejects an item as its own parent", () => {
    const result = validateParentPlacement({
      itemId: "top",
      menuId: MENU,
      parentId: "top",
      existing,
    })
    expect(result.ok).toBe(false)
    expect(result).toHaveProperty("error", expect.stringMatching(/its own parent/i))
  })

  it("rejects a parent that does not exist", () => {
    const result = validateParentPlacement({
      itemId: null,
      menuId: MENU,
      parentId: "ghost",
      existing,
    })
    expect(result.ok).toBe(false)
    expect(result).toHaveProperty("error", expect.stringMatching(/no longer exists|not found/i))
  })

  it("rejects a parent in another menu", () => {
    const result = validateParentPlacement({
      itemId: null,
      menuId: MENU,
      parentId: "elsewhere",
      existing,
    })
    expect(result.ok).toBe(false)
    expect(result).toHaveProperty("error", expect.stringMatching(/same menu/i))
  })

  it("rejects a grandchild — the parent is already a child", () => {
    const result = validateParentPlacement({
      itemId: null,
      menuId: MENU,
      parentId: "child",
      existing,
    })
    expect(result.ok).toBe(false)
    expect(result).toHaveProperty("error", expect.stringMatching(/two levels|one level/i))
  })

  it("rejects moving an item that has children under another item", () => {
    // The cycle guard that is not a self-parent check: nesting `top` would
    // push `child` to depth three without either row mentioning depth.
    const result = validateParentPlacement({
      itemId: "top",
      menuId: MENU,
      parentId: "elsewhere",
      existing: [...existing, { id: "top2", menuId: MENU, parentId: null }],
    })
    expect(result.ok).toBe(false)
  })

  it("rejects moving an item with children even to a valid parent in its own menu", () => {
    const result = validateParentPlacement({
      itemId: "top",
      menuId: MENU,
      parentId: "top2",
      existing: [...existing, { id: "top2", menuId: MENU, parentId: null }],
    })
    expect(result.ok).toBe(false)
    expect(result).toHaveProperty("error", expect.stringMatching(/has items under it|its own items/i))
  })
})

describe("resequence", () => {
  it("produces a clean 0..n-1 sequence per parent group", () => {
    expect(
      resequence([
        { id: "a", parentId: null },
        { id: "b", parentId: null },
        { id: "c", parentId: "a" },
        { id: "d", parentId: "a" },
      ]),
    ).toEqual([
      { id: "a", parentId: null, sortOrder: 0 },
      { id: "b", parentId: null, sortOrder: 1 },
      { id: "c", parentId: "a", sortOrder: 0 },
      { id: "d", parentId: "a", sortOrder: 1 },
    ])
  })

  it("keeps the given order rather than re-sorting", () => {
    expect(resequence([{ id: "z", parentId: null }, { id: "a", parentId: null }])).toEqual([
      { id: "z", parentId: null, sortOrder: 0 },
      { id: "a", parentId: null, sortOrder: 1 },
    ])
  })
})
