import "server-only"
import { asc, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import { blogCategories, blogPosts, blogTags, customPages, menuItems, menus } from "@/db/tables"
import { listInstalledThemes } from "@/Themes/registry"
import { getThemeStatus } from "@/Themes/resolver"
import { resolveMenuHrefs, type EntityIndex, type MenuItemRecord } from "@/Modules/Public/ViewModels/navResolve"
import { buildMenuAdminView, type MenuAdminView, type SlotOrigin } from "../Values/menuAdminView"

/**
 * The Menus screen's data.
 *
 * `server-only` for the same reason `themeAdminQueries` is: `listInstalledThemes()`
 * returns registry entries holding React components, and importing this from a
 * client component would pull every installed theme into the browser bundle.
 *
 * Nothing here decides anything. Which slots exist comes from the registry,
 * which one is rendering comes from the resolver, what is stored comes from the
 * database, and shaping the three into something serialisable is
 * `buildMenuAdminView`'s pure job.
 */

/**
 * Every menu slot any INSTALLED theme declares, with which themes declare it.
 *
 * The union across installed themes, not just the active one, because a menu
 * belongs to a slot rather than to a theme: an operator configuring `sidebar`
 * before activating the theme that renders it is doing something reasonable,
 * and hiding the slot until they switch would make it impossible.
 */
export function installedSlots(): Array<{ slot: string; themes: string[] }> {
  const byslot = new Map<string, string[]>()
  for (const entry of listInstalledThemes()) {
    if (!entry.available) continue
    for (const slot of entry.theme.manifest.menuSlots) {
      const themes = byslot.get(slot)
      if (themes) themes.push(entry.slug)
      else byslot.set(slot, [entry.slug])
    }
  }
  return [...byslot.entries()]
    .map(([slot, themes]) => ({ slot, themes: [...themes].sort() }))
    .sort((a, b) => a.slot.localeCompare(b.slot))
}

/** Entity lookups for the admin: unlike the public path this also reports what
 *  is NOT publicly resolvable, which is how a broken reference is shown. */
async function loadEntities(items: MenuItemRecord[]): Promise<EntityIndex> {
  const idsOf = (type: MenuItemRecord["type"]) => [
    ...new Set(items.filter((item) => item.type === type).map((item) => item.target)),
  ]
  const pageIds = idsOf("page")
  const postIds = idsOf("post")
  const categoryIds = idsOf("category")
  const tagIds = idsOf("tag")

  const [pages, posts, categories, tags] = await Promise.all([
    pageIds.length
      ? db.select({ id: customPages.id, path: customPages.path, isPublished: customPages.isPublished }).from(customPages).where(inArray(customPages.id, pageIds))
      : Promise.resolve([]),
    postIds.length
      ? db.select({ id: blogPosts.id, slug: blogPosts.slug, isPublished: blogPosts.isPublished, deletedAt: blogPosts.deletedAt }).from(blogPosts).where(inArray(blogPosts.id, postIds))
      : Promise.resolve([]),
    categoryIds.length
      ? db.select({ id: blogCategories.id, slug: blogCategories.slug }).from(blogCategories).where(inArray(blogCategories.id, categoryIds))
      : Promise.resolve([]),
    tagIds.length
      ? db.select({ id: blogTags.id, slug: blogTags.slug }).from(blogTags).where(inArray(blogTags.id, tagIds))
      : Promise.resolve([]),
  ])

  return {
    // Only publicly-resolvable entities go in, so the admin's "broken" flag is
    // computed by exactly the rule the public site uses. A draft page shows as
    // broken here because it IS broken as a public link.
    pages: new Map(pages.filter((row) => row.isPublished).map((row) => [row.id, row.path])),
    posts: new Map(
      posts.filter((row) => row.isPublished && row.deletedAt === null).map((row) => [row.id, row.slug]),
    ),
    categories: new Map(categories.map((row) => [row.id, row.slug])),
    tags: new Map(tags.map((row) => [row.id, row.slug])),
  }
}

export async function getMenuAdminView(): Promise<MenuAdminView> {
  const status = await getThemeStatus()
  const slots = installedSlots()

  const menuRows = await db.select().from(menus).orderBy(asc(menus.location))
  const itemRows = menuRows.length
    ? ((await db
        .select()
        .from(menuItems)
        .where(inArray(menuItems.menuId, menuRows.map((row) => row.id)))) as MenuItemRecord[])
    : []

  const resolved = resolveMenuHrefs(itemRows, await loadEntities(itemRows))

  // Which slots the theme actually rendering consumes. Everything else is
  // stored, listed, and simply not asked for right now.
  const renderingTheme = listInstalledThemes().find(
    (entry) => entry.available && entry.slug === status.activeSlug,
  )
  const renderingSlots: string[] = renderingTheme?.available
    ? renderingTheme.theme.manifest.menuSlots
    : []

  return buildMenuAdminView({
    menus: menuRows.map((row) => ({
      id: row.id,
      name: row.name,
      location: row.location,
      items: resolved.filter((item) => item.menuId === row.id),
    })),
    installedSlots: slots,
    renderingSlots,
    renderingThemeSlug: status.activeSlug,
  })
}

export type { SlotOrigin }
