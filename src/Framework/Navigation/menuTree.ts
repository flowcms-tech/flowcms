import type { NavItem } from "@/Themes/contract/views"

/**
 * The menu tree: how rows become navigation, and what a mutation may create.
 *
 * PURE AND DEPENDENCY-FREE. No database, no React, no configuration. The public
 * render path and the admin mutation path both use it, which is the only way
 * the two can be guaranteed to agree about what "depth 2" means.
 *
 * THE TWO HALVES ARE DELIBERATELY ASYMMETRIC:
 *
 *   `buildNavTree` is FORGIVING. It is handed whatever the database holds,
 *   including rows written by an older version or edited by hand, and its
 *   contract is that it always returns a renderable tree and always terminates.
 *
 *   `validateParentPlacement` is STRICT. It refuses to create the states the
 *   builder has to tolerate.
 *
 * Same shape as `resolveTheme` / `setActiveTheme`, for the same reason: new bad
 * state should be impossible, and existing bad state must not take the site
 * down.
 */

/** A menu row with its href already resolved by core. Null href = unresolvable
 *  (deleted post, unpublished page) and the item will not be rendered. */
export interface ResolvedMenuItem {
  id: string
  menuId: string
  parentId: string | null
  label: string
  href: string | null
  sortOrder: number
  isActive: boolean
  opensInNewTab: boolean
}

/**
 * Total ordering.
 *
 * `sortOrder` alone is a partial order — two items may legitimately share a
 * value after a hand-edited row or a partially-applied reorder — and a partial
 * order handed to `Array.prototype.sort` produces an implementation-defined
 * result. That would render one order in a test and another in production, or
 * change between engines because the rows arrived in a different sequence.
 *
 * So the comparison falls through to `label` and finally to `id`, which is
 * unique. Ordering is therefore a function of the data alone and never of the
 * order the database happened to return rows in.
 */
function compare(a: ResolvedMenuItem, b: ResolvedMenuItem): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  const byLabel = a.label.localeCompare(b.label)
  if (byLabel !== 0) return byLabel
  return a.id.localeCompare(b.id)
}

function toNavItem(row: ResolvedMenuItem, children: NavItem[]): NavItem {
  return {
    label: row.label,
    // Non-null by construction: rows with a null href are filtered out before
    // this is reached.
    href: row.href as string,
    opensInNewTab: row.opensInNewTab,
    children,
  }
}

/**
 * Build the navigation tree for one menu.
 *
 * NON-RECURSIVE, and that is a safety property rather than a style choice. The
 * obvious implementation walks parent pointers, and a cycle in the data —
 * `a.parent = b`, `b.parent = a`, which no mutation can create but a hand-edited
 * row can — makes that walk run until the stack overflows, on a public page, on
 * every request. Two passes over a flat list cannot loop no matter what the
 * data says.
 *
 * WHAT IS DROPPED, AND WHY DROPPING RATHER THAN PROMOTING:
 *
 *   - inactive items, and everything under them;
 *   - items whose href did not resolve, and everything under them;
 *   - items whose parent is missing, inactive, unresolvable, in another menu,
 *     or itself a child (a grandchild);
 *   - every item in a cycle, since a cycle contains no top-level row.
 *
 * A dropped item is invisible on the public site and still present in the
 * admin, where the operator can see the problem and fix or delete it. The
 * alternative — promoting an orphan to the top level — puts a link somewhere
 * nobody chose to put it, which on a navigation bar is the more surprising of
 * the two failures.
 */
export function buildNavTree(rows: ResolvedMenuItem[]): NavItem[] {
  const renderable = rows.filter((row) => row.isActive && row.href !== null)

  // Pass one: the roots. `parentId === null` is the only definition of "top
  // level", so an item in a cycle is never a root and is therefore never
  // reached by pass two.
  const roots = renderable.filter((row) => row.parentId === null)
  const rootIds = new Set(roots.map((row) => row.id))
  const rootMenu = new Map(roots.map((row) => [row.id, row.menuId]))

  // Pass two: children, bucketed by parent. An item whose parent is not in
  // `rootIds` is a grandchild, an orphan, or part of a cycle — all dropped,
  // and all without following a single pointer.
  const childrenByParent = new Map<string, ResolvedMenuItem[]>()
  for (const row of renderable) {
    if (row.parentId === null) continue
    if (!rootIds.has(row.parentId)) continue
    // A parent in a different menu is a data error, not a nesting decision.
    if (rootMenu.get(row.parentId) !== row.menuId) continue
    const bucket = childrenByParent.get(row.parentId)
    if (bucket) bucket.push(row)
    else childrenByParent.set(row.parentId, [row])
  }

  return [...roots]
    .sort(compare)
    .map((root) =>
      toNavItem(
        root,
        [...(childrenByParent.get(root.id) ?? [])].sort(compare).map((child) => toNavItem(child, [])),
      ),
    )
}

// -- The mutation side --------------------------------------------------------

/** The subset of a row this validation needs. */
export interface PlacementRow {
  id: string
  menuId: string
  parentId: string | null
}

export type PlacementResult = { ok: true } | { ok: false; error: string }

/**
 * Whether an item may sit under `parentId`.
 *
 * Called on create and on every edit that touches `parentId`. Rejects, in the
 * order an operator would want to be told:
 *
 *   1. an item as its own parent;
 *   2. a parent that does not exist;
 *   3. a parent in a different menu;
 *   4. a parent that is itself a child — the depth-2 rule;
 *   5. moving an item that HAS children underneath another item.
 *
 * Rule 5 is the one that is easy to miss and is where cycles would otherwise
 * come from. Neither row in `top → child` mentions depth, so nesting `top`
 * under something else pushes `child` to depth three by a write that looks
 * local and legal. Checking the item's own children is what makes the depth cap
 * hold across an edit rather than only at creation.
 */
export function validateParentPlacement(args: {
  /** Null when creating; the item's own id when editing. */
  itemId: string | null
  menuId: string
  parentId: string | null
  /** Every menu item that currently exists, across menus. */
  existing: PlacementRow[]
}): PlacementResult {
  const { itemId, menuId, parentId, existing } = args

  if (parentId === null) return { ok: true }

  if (itemId !== null && parentId === itemId) {
    return { ok: false, error: "An item cannot be its own parent." }
  }

  const parent = existing.find((row) => row.id === parentId)
  if (!parent) {
    return { ok: false, error: "That parent item no longer exists." }
  }

  if (parent.menuId !== menuId) {
    return { ok: false, error: "A parent item must belong to the same menu." }
  }

  if (parent.parentId !== null) {
    return {
      ok: false,
      error: "Menus are two levels deep: an item can sit under a top-level item, but not under another sub-item.",
    }
  }

  if (itemId !== null && existing.some((row) => row.parentId === itemId)) {
    return {
      ok: false,
      error: "This item has items under it, so it cannot be nested. Move or delete its own items first.",
    }
  }

  return { ok: true }
}

/**
 * Assign a clean `0..n-1` sequence within each parent group, preserving the
 * order given.
 *
 * Reordering by rewriting the whole group is what keeps `sortOrder` meaningful.
 * Incremental swaps leave gaps and duplicates behind, which still render
 * correctly — `buildNavTree` has a total order — but make the stored data
 * progressively less readable to anyone looking at the table.
 */
export function resequence(
  items: Array<{ id: string; parentId: string | null }>,
): Array<{ id: string; parentId: string | null; sortOrder: number }> {
  const nextIndex = new Map<string, number>()
  return items.map((entry) => {
    const key = entry.parentId ?? ""
    const index = nextIndex.get(key) ?? 0
    nextIndex.set(key, index + 1)
    return { ...entry, sortOrder: index }
  })
}
