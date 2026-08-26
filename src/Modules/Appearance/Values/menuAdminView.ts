import type { MenuItemType } from "@/db/schema/menus"
import type { ResolvedMenuItem } from "@/Framework/Navigation/menuTree"

/**
 * The model the Menus screen renders from, and the serialization boundary
 * between the registry/database and the browser.
 *
 * PURE. It takes stored menus, the slots installed themes declare, and the
 * slots the rendering theme consumes, as arguments — so every operator-visible
 * state, including the ones that only occur after a theme switch, is
 * constructible in a test with no database and no registry.
 *
 * VOCABULARY, which the UI must not blur:
 *
 *   rendered   — the rendering theme declares this slot, so this menu is live
 *                on the public site right now.
 *   installed  — some installed theme declares this slot, but not the one
 *                rendering. The menu is stored and dormant.
 *   unknown    — no installed theme declares this slot. Usually a theme that
 *                was removed. Still stored, still editable, never deleted.
 *
 * That third state is the reason this file exists. Deleting or rewriting an
 * "unknown" menu would destroy an operator's work because they changed theme,
 * which is precisely what the brief forbids.
 */

export type SlotOrigin = "rendered" | "installed" | "unknown"

export interface MenuItemAdminView {
  id: string
  label: string
  type: MenuItemType
  /** The raw stored value: a path/URL for `custom`, an entity id otherwise.
   *  Shown so an operator can see what a broken item points at. */
  target: string
  /** Where this item would send a visitor, or null when it cannot be resolved.
   *  Null is what the UI renders as a broken reference. */
  href: string | null
  parentId: string | null
  sortOrder: number
  isActive: boolean
  opensInNewTab: boolean
  /** True when the item names an entity that is gone or no longer public.
   *  Always false for `custom`, whose target is validated on write. */
  isBroken: boolean
}

export interface MenuAdminItemGroup {
  item: MenuItemAdminView
  children: MenuItemAdminView[]
}

export interface MenuAdminView {
  menus: Array<{
    id: string
    name: string
    location: string
    origin: SlotOrigin
    /** Which installed themes declare this location. Empty for `unknown`. */
    declaredBy: string[]
    /** Top-level items, each with its children, in render order. Unlike the
     *  public tree this KEEPS broken and inactive items — the admin is where
     *  they get fixed. */
    groups: MenuAdminItemGroup[]
    /** Items the public tree would drop for a structural reason (a parent that
     *  is missing, in another menu, or itself a child). Surfaced rather than
     *  hidden, so an operator can see why a link vanished. */
    orphanCount: number
  }>
  /** Slots with no menu yet, offered as somewhere to create one. */
  availableSlots: Array<{ slot: string; themes: string[]; origin: SlotOrigin }>
  renderingThemeSlug: string
}

function toItemView(row: ResolvedMenuItem, target: string, type: MenuItemType): MenuItemAdminView {
  return {
    id: row.id,
    label: row.label,
    type,
    target,
    href: row.href,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    opensInNewTab: row.opensInNewTab,
    // A custom item with a null href failed target validation, which the write
    // path prevents — so in practice this is only ever an entity item.
    isBroken: row.href === null,
  }
}

/** Same total ordering the public tree uses, so the admin list and the public
 *  menu are never in a different order. */
function compare(a: MenuItemAdminView, b: MenuItemAdminView): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  const byLabel = a.label.localeCompare(b.label)
  if (byLabel !== 0) return byLabel
  return a.id.localeCompare(b.id)
}

export interface MenuAdminInput {
  menus: Array<{
    id: string
    name: string
    location: string
    /** Resolved rows, carrying their original `type` and `target`. */
    items: Array<ResolvedMenuItem & { type?: MenuItemType; target?: string }>
  }>
  installedSlots: Array<{ slot: string; themes: string[] }>
  renderingSlots: string[]
  renderingThemeSlug: string
}

export function buildMenuAdminView(input: MenuAdminInput): MenuAdminView {
  const rendering = new Set(input.renderingSlots)
  const declaredBy = new Map(input.installedSlots.map((entry) => [entry.slot, entry.themes]))

  const originOf = (location: string): SlotOrigin => {
    if (rendering.has(location)) return "rendered"
    if (declaredBy.has(location)) return "installed"
    return "unknown"
  }

  const menus = input.menus.map((menu) => {
    const views = menu.items.map((row) =>
      toItemView(row, row.target ?? "", (row.type ?? "custom") as MenuItemType),
    )

    const roots = views.filter((item) => item.parentId === null)
    const rootIds = new Set(roots.map((item) => item.id))

    const childrenByParent = new Map<string, MenuItemAdminView[]>()
    let orphanCount = 0
    for (const item of views) {
      if (item.parentId === null) continue
      if (!rootIds.has(item.parentId)) {
        // A grandchild, an orphan, or part of a cycle. Counted rather than
        // rendered: the admin's job is to say "some items are not reachable",
        // not to invent a position for them.
        orphanCount += 1
        continue
      }
      const bucket = childrenByParent.get(item.parentId)
      if (bucket) bucket.push(item)
      else childrenByParent.set(item.parentId, [item])
    }

    return {
      id: menu.id,
      name: menu.name,
      location: menu.location,
      origin: originOf(menu.location),
      declaredBy: declaredBy.get(menu.location) ?? [],
      groups: [...roots].sort(compare).map((item) => ({
        item,
        children: [...(childrenByParent.get(item.id) ?? [])].sort(compare),
      })),
      orphanCount,
    }
  })

  const taken = new Set(input.menus.map((menu) => menu.location))

  return {
    menus: menus.sort((a, b) => {
      // Live slots first — the answer to the question an operator opened this
      // screen with — then the rest by location so the order is stable.
      if ((a.origin === "rendered") !== (b.origin === "rendered")) {
        return a.origin === "rendered" ? -1 : 1
      }
      return a.location.localeCompare(b.location)
    }),
    availableSlots: input.installedSlots
      .filter((entry) => !taken.has(entry.slot))
      .map((entry) => ({ ...entry, origin: originOf(entry.slot) })),
    renderingThemeSlug: input.renderingThemeSlug,
  }
}
