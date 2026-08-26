export interface CustomPage extends Record<string, unknown> {
  id: string
  title: string
  path: string
  content: string
  metaTitle: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  ogImageKey: string | null
  ogImageUrl: string | null
  isIndexable: boolean
  isPublished: boolean
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CustomPagePayload {
  title: string
  path: string
  content: string
  metaTitle?: string
  metaDescription?: string
  canonicalUrl?: string
  ogImageKey?: string | null
  isIndexable?: boolean
}
