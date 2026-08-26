export interface Author extends Record<string, unknown> {
  id: string
  name: string
  slug: string
  jobTitle: string | null
  credentials: string | null
  bio: string | null
  avatarKey: string | null
  avatarAltText: string | null
  avatarUrl: string | null
  email: string | null
  websiteUrl: string | null
  linkedinUrl: string | null
  twitterUrl: string | null
  facebookUrl: string | null
  instagramUrl: string | null
  metaTitle: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  isIndexable: boolean
  isActive: boolean
  /** How many posts credit this author — drives the delete guard. */
  postCount: number
}

export interface AuthorPayload {
  name: string
  slug: string
  jobTitle?: string
  credentials?: string
  bio?: string
  avatarKey?: string
  avatarAltText?: string
  email?: string
  websiteUrl?: string
  linkedinUrl?: string
  twitterUrl?: string
  facebookUrl?: string
  instagramUrl?: string
  metaTitle?: string
  metaDescription?: string
  canonicalUrl?: string
  isIndexable?: boolean
}
