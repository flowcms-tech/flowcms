import type { MenuItemType } from "@/db/schema/menus"
import {
  pageHref,
  postHref,
  sanitizeCustomTarget,
  taxonomyHref,
} from "@/Framework/Navigation/menuTarget"
import type { ResolvedMenuItem } from "@/Framework/Navigation/menuTree"

/**
 * What each menu item points at, given the entities that currently exist.
 *
 * PURE. It takes the rows and a lookup of entities rather than reaching for a
 * database, so every outcome — including "the post this item names was deleted
 * last week" — is constructible in a test without one.
 *
 * WHY ENTITY ITEMS STORE AN ID AND RESOLVE HERE
 *
 * A menu item pointing at a post stores the post's id, and the URL is computed
 * on every render. Storing the URL instead would go stale the moment somebody
 * changed the post's slug — and FlowCMS creates a redirect for exactly that, so
 * the menu would keep sending every visitor through a redirect, forever, with
 * nothing in the admin to suggest why.
 */

/** The stored shape of a menu item, before its href is known. */
export interface MenuItemRecord {
  id: string
  menuId: string
  parentId: string | null
  label: string
  type: MenuItemType
  target: string
  sortOrder: number
  isActive: boolean
  opensInNewTab: boolean
}

/**
 * The publicly-resolvable entities, keyed by id.
 *
 * Only entities that may actually be linked to are in here — a published page,
 * a published and untrashed post. An id that is absent is an item whose target
 * is gone or is no longer public, and the distinction between those two is
 * deliberately not made: both mean "do not link to this".
 */
export interface EntityIndex {
  /** id → the page's current public path. */
  pages: Map<string, string>
  /** id → the post's current slug. */
  posts: Map<string, string>
  /** id → slug. */
  categories: Map<string, string>
  /** id → slug. */
  tags: Map<string, string>
}

function hrefFor(item: MenuItemRecord, entities: EntityIndex): string | null {
  switch (item.type) {
    case "custom":
      return sanitizeCustomTarget(item.target)
    case "page": {
      const path = entities.pages.get(item.target)
      return path === undefined ? null : pageHref(path)
    }
    case "post": {
      const slug = entities.posts.get(item.target)
      return slug === undefined ? null : postHref(slug)
    }
    case "category": {
      const slug = entities.categories.get(item.target)
      return slug === undefined ? null : taxonomyHref("category", slug)
    }
    case "tag": {
      const slug = entities.tags.get(item.target)
      return slug === undefined ? null : taxonomyHref("tag", slug)
    }
  }
}

/**
 * Attach an href to every row. Rows whose target cannot be resolved get null
 * and are KEPT — `buildNavTree` drops them from the public tree, and the admin
 * uses the same null to show the operator a broken reference they can fix.
 * Dropping them here would make the admin unable to tell a broken item from an
 * item that was never there.
 */
export function resolveMenuHrefs(
  items: MenuItemRecord[],
  entities: EntityIndex,
): ResolvedMenuItem[] {
  return items.map((item) => ({
    id: item.id,
    menuId: item.menuId,
    parentId: item.parentId,
    label: item.label,
    href: hrefFor(item, entities),
    sortOrder: item.sortOrder,
    isActive: item.isActive,
    opensInNewTab: item.opensInNewTab,
  }))
}
