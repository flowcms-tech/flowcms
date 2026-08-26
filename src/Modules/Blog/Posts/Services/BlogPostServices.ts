import BAPI from '@/Framework/API_Layer'
import type { BlogPost, BlogPostPayload, BlogPostRevision, SchemaType } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

/** What `duplicate` hands back. Deliberately not a full `BlogPost`: the only
 *  thing the caller does with it is navigate to the copy's edit screen, which
 *  loads the post properly anyway. */
export interface DuplicatedPostRef {
  id: string
  title: string
  slug: string
}

/**
 * Fields the bulk route accepts, and nothing else.
 *
 * `metaTitle` and `metaDescription` are absent on purpose and the route rejects
 * them outright — pasting one description onto 40 posts creates exactly the
 * duplicate-content problem the field exists to prevent. The bulk form of those
 * two is a template applied per post, not a literal.
 */
export interface BulkPostChanges {
  isIndexable?: boolean
  primaryCategoryId?: string | null
  addCategoryIds?: string[]
  removeCategoryIds?: string[]
  addTagIds?: string[]
  removeTagIds?: string[]
  focusKeyword?: string | null
  schemaType?: SchemaType
  isCornerstone?: boolean
  seriesId?: string | null
}

export interface BulkPostResult {
  id: string
  ok: boolean
  /** Why this one was skipped — a lock held by another admin, a primary
   *  category the post is not in. Always present on a failure. */
  message?: string
}

/** A manual related-post override as the API returns it. `isTrashed` comes
 *  back rather than the row being dropped, so the panel can show the editor
 *  why a post they picked is no longer usable. */
export interface RelatedPostRef {
  id: string
  title: string
  slug: string
  isPublished: boolean
  isTrashed: boolean
  position: number
}

export interface LinkSuggestion {
  id: string
  title: string
  slug: string
  focusKeyword: string | null
  isCornerstone: boolean
  score: number
}

export const BlogPostServices = {
  async list(search?: string, trashed = false): Promise<BlogPost[]> {
    const res = await BAPI.get<ApiResponse<BlogPost[]>>(
      '/api/blog/posts',
      {
        params: {
          ...(search ? { search } : {}),
          ...(trashed ? { trashed: 'true' } : {}),
        },
        showGlobalError: true,
        showGlobalSuccess: false,
      }
    )
    return res.data
  },

  async get(id: string): Promise<BlogPost> {
    const res = await BAPI.get<ApiResponse<BlogPost>>(
      `/api/blog/posts/${id}`,
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async store(payload: BlogPostPayload): Promise<BlogPost> {
    const res = await BAPI.post<ApiResponse<BlogPost>>(
      '/api/blog/posts',
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async update(id: string, payload: Partial<BlogPostPayload>): Promise<BlogPost> {
    const res = await BAPI.patch<ApiResponse<BlogPost>>(
      `/api/blog/posts/${id}`,
      payload,
      {
        showGlobalError: false,
        showGlobalSuccess: true,
        // Without this, BAPI strips `''` from the body and the route reads a
        // cleared field as absent — "leave unchanged". `canonicalUrl`,
        // `metaTitle`, `metaDescription` and `focusKeyword` could all be set
        // once and then never blanked again from the form, with no error and
        // no visible symptom. `clearSeries`/`clearPrimaryCategory` exist
        // because relations still need an explicit flag; plain text fields do
        // not, once empty strings actually reach the server.
        keepEmptyStrings: true,
      }
    )
    return res.data
  },

  async changePublished(id: string, isPublished: boolean): Promise<BlogPost> {
    const res = await BAPI.patch<ApiResponse<BlogPost>>(
      `/api/blog/posts/${id}`,
      { isPublished },
      { showGlobalError: true, showGlobalSuccess: true }
    )
    return res.data
  },

  /** Moves the post to the trash. Reversible — see `restore`. */
  async delete(id: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      `/api/blog/posts/${id}`,
      undefined,
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },

  async restore(id: string): Promise<BlogPost> {
    const res = await BAPI.post<ApiResponse<BlogPost>>(
      `/api/blog/posts/${id}`,
      {},
      { showGlobalError: true, showGlobalSuccess: true }
    )
    return res.data
  },

  /** Destroys the post, its FAQs, relations, and revision history. The API
   *  rejects this unless the post is already in the trash. */
  async deletePermanently(id: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      `/api/blog/posts/${id}?permanent=true`,
      undefined,
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },

  async listRevisions(id: string): Promise<BlogPostRevision[]> {
    const res = await BAPI.get<ApiResponse<BlogPostRevision[]>>(
      `/api/blog/posts/${id}/revisions`,
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async restoreRevision(id: string, revisionId: string): Promise<void> {
    await BAPI.post<ApiResponse<unknown>>(
      `/api/blog/posts/${id}/revisions/${revisionId}`,
      {},
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },

  /** Clones the post as a draft with a `-copy` slug and a cleared canonical.
   *  Returns just enough to route to the copy's edit screen. */
  async duplicate(id: string): Promise<DuplicatedPostRef> {
    const res = await BAPI.post<ApiResponse<DuplicatedPostRef>>(
      `/api/blog/posts/${id}/duplicate`,
      {},
      { showGlobalError: true, showGlobalSuccess: true }
    )
    return res.data
  },

  /** Capped at 100 ids per call. Partial failure is normal, not exceptional —
   *  a post locked by another admin is skipped and reported, so the caller has
   *  to render the returned rows rather than assume the whole batch landed. */
  async bulkUpdate(ids: string[], changes: BulkPostChanges): Promise<BulkPostResult[]> {
    const res = await BAPI.patch<ApiResponse<BulkPostResult[]>>(
      '/api/blog/posts/bulk',
      { ids, changes },
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async getRelated(id: string): Promise<RelatedPostRef[]> {
    const res = await BAPI.get<ApiResponse<RelatedPostRef[]>>(
      `/api/blog/posts/${id}/related`,
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  /** Replace-all: the array sent IS the list, in the order sent. Pass `[]` to
   *  drop every override and fall back to automatic scoring. */
  async setRelated(id: string, relatedPostIds: string[]): Promise<string[]> {
    const res = await BAPI.put<ApiResponse<string[]>>(
      `/api/blog/posts/${id}/related`,
      { relatedPostIds },
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  /** Published posts worth linking to from `postId`, best first, max 10.
   *  With no `q`, the source post's own focus keyword and title are the query. */
  async linkSuggestions(postId?: string, q?: string): Promise<LinkSuggestion[]> {
    const res = await BAPI.get<ApiResponse<LinkSuggestion[]>>(
      '/api/blog/posts/link-suggestions',
      {
        params: {
          ...(postId ? { postId } : {}),
          ...(q ? { q } : {}),
        },
        showGlobalError: true,
        showGlobalSuccess: false,
      }
    )
    return res.data
  },
}
