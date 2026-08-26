import "server-only"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { blogCategories, blogPosts, blogTags, customPages } from "@/db/tables"
import type { MenuItemType } from "@/db/schema/menus"

/**
 * Business-rule checks the item routes share.
 *
 * Both the create and the edit route need exactly these, and two copies of
 * "does this entity exist" is two chances for one of them to drift into
 * accepting a target the other refuses.
 */

/**
 * Whether an entity-backed target names something that exists.
 *
 * Deliberately checks EXISTENCE, not publication. An editor adding a menu item
 * for a post they are about to publish is doing something ordinary, and
 * refusing it would force them to publish first and remember to come back. The
 * public render path is where publication is enforced — the item resolves to
 * null and simply does not appear until the post goes live — and the admin
 * screen flags it as broken in the meantime, which is the honest state.
 *
 * Returns an operator-facing message, or null when the target is fine.
 */
export async function checkEntityTarget(
  type: MenuItemType,
  target: string,
): Promise<string | null> {
  if (type === "custom") return null

  const found = await (async () => {
    switch (type) {
      case "page": {
        const [row] = await db.select({ id: customPages.id }).from(customPages).where(eq(customPages.id, target)).limit(1)
        return Boolean(row)
      }
      case "post": {
        const [row] = await db.select({ id: blogPosts.id }).from(blogPosts).where(eq(blogPosts.id, target)).limit(1)
        return Boolean(row)
      }
      case "category": {
        const [row] = await db.select({ id: blogCategories.id }).from(blogCategories).where(eq(blogCategories.id, target)).limit(1)
        return Boolean(row)
      }
      case "tag": {
        const [row] = await db.select({ id: blogTags.id }).from(blogTags).where(eq(blogTags.id, target)).limit(1)
        return Boolean(row)
      }
    }
  })()

  if (found) return null

  const noun = type === "post" ? "post" : type === "page" ? "page" : type
  // Names the type and not the id: the id came from the request and echoing it
  // back adds nothing an operator can use.
  return `That ${noun} does not exist. Choose another, or use a custom link.`
}
