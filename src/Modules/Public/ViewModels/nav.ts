import "server-only"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/db/client"
import { blogCategories, blogPosts, blogTags, customPages, menuItems, menus } from "@/db/tables"
import { buildNavTree } from "@/Framework/Navigation/menuTree"
import type { NavView } from "@/Themes/contract/views"
import { resolveMenuHrefs, type EntityIndex, type MenuItemRecord } from "./navResolve"

/**
 * The navigation a theme receives.
 *
 * THE ONLY PLACE MENUS ARE READ FOR THE PUBLIC SITE. `ThemeShell` calls it once
 * per page with the slots the RENDERING theme declares; nothing else does. A
 * public route that fetched its own navigation would render a different menu
 * from the shell wrapped around it, and neither would be obviously wrong.
 *
 * SLOT FILTERING IS THE WHOLE MECHANISM. A theme is handed menus for the slots
 * it declared and nothing else. Switching themes therefore changes which menus
 * are consumed without touching a single row: a menu at `sidebar` is simply not
 * asked for while a theme that declares only `primary` and `footer` is active,
 * and it comes back untouched when a theme declaring `sidebar` is activated
 * again. There is no write on this path — none at all — so no render can
 * "clean up" a menu belonging to another theme.
 */

/** Batch-load the entities menu items point at, in one query per type. */
async function loadEntities(items: MenuItemRecord[]): Promise<EntityIndex> {
  const idsOf = (type: MenuItemRecord["type"]) => [
    ...new Set(items.filter((item) => item.type === type).map((item) => item.target)),
  ]

  const pageIds = idsOf("page")
  const postIds = idsOf("post")
  const categoryIds = idsOf("category")
  const tagIds = idsOf("tag")

  // `inArray` with an empty list is invalid SQL on some engines, so each query
  // is skipped when nothing needs it. This also means a menu of custom links
  // costs exactly one query for the items and none for entities.
  const [pages, posts, categories, tags] = await Promise.all([
    pageIds.length
      ? db
          .select({ id: customPages.id, path: customPages.path })
          .from(customPages)
          // Published only. An item pointing at a draft page resolves to null
          // and is omitted — a public menu must not advertise a 404.
          .where(and(inArray(customPages.id, pageIds), eq(customPages.isPublished, true)))
      : Promise.resolve([]),
    postIds.length
      ? db
          .select({ id: blogPosts.id, slug: blogPosts.slug })
          .from(blogPosts)
          // `isNull(deletedAt)` alongside `isPublished`, matching every other
          // public blog query: a trashed post is unpublished on trash anyway,
          // and relying on that alone would make this the one read that broke
          // if the two ever came apart.
          .where(
            and(
              inArray(blogPosts.id, postIds),
              eq(blogPosts.isPublished, true),
              isNull(blogPosts.deletedAt),
            ),
          )
      : Promise.resolve([]),
    categoryIds.length
      ? db
          .select({ id: blogCategories.id, slug: blogCategories.slug })
          .from(blogCategories)
          .where(inArray(blogCategories.id, categoryIds))
      : Promise.resolve([]),
    tagIds.length
      ? db
          .select({ id: blogTags.id, slug: blogTags.slug })
          .from(blogTags)
          .where(inArray(blogTags.id, tagIds))
      : Promise.resolve([]),
  ])

  return {
    pages: new Map(pages.map((row) => [row.id, row.path])),
    posts: new Map(posts.map((row) => [row.id, row.slug])),
    categories: new Map(categories.map((row) => [row.id, row.slug])),
    tags: new Map(tags.map((row) => [row.id, row.slug])),
  }
}

/**
 * Build the `NavView` for a set of theme slots.
 *
 * Returns a key only for a slot that actually has a menu, so
 * `nav.slots.primary` is `undefined` when nothing is configured — which is what
 * the contract promises and what every theme's `?? []` already handles.
 *
 * NEVER THROWS ON MISSING DATA and never writes. An empty slot list short-
 * circuits before any query, which is the common case for a theme with no
 * navigation at all.
 */
export async function getNavView(slots: string[]): Promise<NavView> {
  const wanted = [...new Set(slots)].filter((slot) => slot.length > 0)
  if (wanted.length === 0) return { slots: {} }

  const menuRows = await db
    .select({ id: menus.id, location: menus.location })
    .from(menus)
    .where(inArray(menus.location, wanted))

  if (menuRows.length === 0) return { slots: {} }

  const itemRows = await db
    .select()
    .from(menuItems)
    .where(inArray(menuItems.menuId, menuRows.map((row) => row.id)))

  const entities = await loadEntities(itemRows as MenuItemRecord[])
  const resolved = resolveMenuHrefs(itemRows as MenuItemRecord[], entities)

  const out: NavView["slots"] = {}
  for (const menu of menuRows) {
    out[menu.location] = buildNavTree(resolved.filter((item) => item.menuId === menu.id))
  }
  return { slots: out }
}
