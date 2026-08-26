export interface BlogCategory extends Record<string, unknown> {
  id: string
  name: string
  slug: string
  description: string | null
  parentId: string | null
  depth: number
  imageKey: string | null
  imageUrl: string | null
  ogImageKey: string | null
  ogImageUrl: string | null
  metaTitle: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  /** noindex on this archive when false. Distinct from `isActive`, which hides
   *  the category from the site entirely. */
  isIndexable: boolean
  archiveIntro: string | null
  /** Published, untrashed posts in this category. */
  postCount: number
  /** The subset that is also indexable. Zero means the archive is noindexed and
   *  dropped from the sitemap regardless of `isIndexable` — computed on every
   *  read, never stored. */
  indexablePostCount: number
  isActive: boolean
}

export interface BlogCategoryPayload {
  name: string
  slug: string
  description?: string
  parentId?: string | null
  imageKey?: string | null
  ogImageKey?: string | null
  metaTitle?: string
  metaDescription?: string
  canonicalUrl?: string
  isIndexable?: boolean
  archiveIntro?: string
}

export interface BlogCategoryImageUploadResult {
  key: string
  url: string
}
