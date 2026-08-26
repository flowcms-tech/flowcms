export interface BlogTag extends Record<string, unknown> {
  id: string
  name: string
  slug: string
  metaTitle: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  /** noindex on this archive when false. Distinct from `isActive`, which hides
   *  the tag from the site entirely. */
  isIndexable: boolean
  archiveIntro: string | null
  /** Published, untrashed posts carrying this tag. */
  postCount: number
  /** The subset that is also indexable. Zero means the archive is noindexed and
   *  dropped from the sitemap regardless of `isIndexable` — computed on every
   *  read, never stored. */
  indexablePostCount: number
  isActive: boolean
}

export interface BlogTagPayload {
  name: string
  slug: string
  metaTitle?: string
  metaDescription?: string
  canonicalUrl?: string
  isIndexable?: boolean
  archiveIntro?: string
}
