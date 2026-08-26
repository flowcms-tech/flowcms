import "server-only"

import { and, eq } from "drizzle-orm"
import { db } from "@/db/client"
import { customPages } from "@/db/tables"
import { StorageService } from "@/Framework/Storage/StorageService"
import type { PublicCustomPage } from "@/Themes/contract/views"

const IMAGE_URL_TTL_SECONDS = 3600

/**
 * Defined on the theme contract since Phase 7.2. It used to be inferred from
 * this function:
 *
 *     export type PublicCustomPage =
 *       NonNullable<Awaited<ReturnType<typeof getPublishedPageByPath>>>
 *
 * which read as convenient and was two bugs. It leaked `createdById`,
 * `createdAt`, `isPublished` and the raw `ogImageKey` to every theme, and its
 * declaration reached into Drizzle and `server-only` — so a published
 * `flowcms/theme` would have demanded a theme author install FlowCMS's database
 * layer to typecheck a page component.
 *
 * The return type below is now an ANNOTATION rather than an inference, so the
 * narrowing is enforced: adding a column to `custom_page` no longer widens what
 * a theme can see, and removing one a theme depends on fails this file.
 */
export type { PublicCustomPage } from "@/Themes/contract/views"

export async function getPublishedPageByPath(path: string): Promise<PublicCustomPage | null> {
  const row = await db.query.customPages.findFirst({
    where: and(eq(customPages.path, path), eq(customPages.isPublished, true)),
  })
  if (!row) return null

  const ogImageUrl = row.ogImageKey
    ? await StorageService.getPresignedDownloadUrl(row.ogImageKey, IMAGE_URL_TTL_SECONDS)
    : null

  return { ...row, ogImageUrl }
}
