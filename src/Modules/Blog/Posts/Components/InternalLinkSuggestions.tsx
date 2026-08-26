'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link2, Search } from 'lucide-react'
import BAPI from '@/Framework/API_Layer'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import { extractLinks } from '../Values/contentStats'

interface ApiResponse<T> { data: T; message: string | string[] }

export interface LinkSuggestion {
  id: string
  title: string
  slug: string
  focusKeyword: string | null
}

/**
 * Mirrors `BlogPostServices.linkSuggestions`, kept local because this panel
 * wants failures to stay silent — a suggestions list that cannot load should
 * quietly show nothing, not raise a toast over the editor while someone is
 * writing. The service uses the standard read toast policy.
 */
async function fetchLinkSuggestions(postId: string | null, q: string): Promise<LinkSuggestion[]> {
  const res = await BAPI.get<ApiResponse<LinkSuggestion[]>>('/api/blog/posts/link-suggestions', {
    params: { ...(postId ? { postId } : {}), ...(q ? { q } : {}) },
    showGlobalError: false,
    showGlobalSuccess: false,
  })
  return res.data
}

export interface InternalLinkSuggestionsProps {
  /** Null on the create screen — suggestions still work, they just cannot
   *  exclude "this post" or seed from its focus keyword. */
  postId: string | null
  /** Current editor HTML, used to list what is already linked. */
  content: string
  /** Inserts HTML at the TinyMCE caret. Returns false when the editor has not
   *  initialised yet, which is the only failure worth telling the editor about. */
  onInsertLink: (html: string) => boolean
  disabled?: boolean
}

export default function InternalLinkSuggestions({
  postId,
  content,
  onInsertLink,
  disabled,
}: InternalLinkSuggestionsProps) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  const { data: suggestions, isLoading, isError } = useQuery({
    queryKey: ['blog-post-link-suggestions', postId, debouncedSearch],
    queryFn: () => fetchLinkSuggestions(postId, debouncedSearch),
    // A missing route must not spam the toast layer or retry in a loop — this
    // panel is a convenience, and the Content tab has to stay usable without it.
    retry: false,
  })

  /** Site-relative hrefs already in the body. `/blog/...` slugs are pulled out
   *  separately so an already-linked suggestion is obvious at a glance. */
  const existing = useMemo(() => {
    const links = extractLinks(content).filter(
      (link) => link.href.startsWith('/') && !link.href.startsWith('//')
    )
    const slugs = new Set(
      links
        .map((link) => link.href.match(/^\/blog\/([^/?#]+)/)?.[1])
        .filter((slug): slug is string => !!slug)
    )
    return { links, slugs }
  }, [content])

  function insert(suggestion: LinkSuggestion) {
    const html = `<a href="/blog/${suggestion.slug}">${suggestion.title}</a>`
    if (!onInsertLink(html)) {
      setNotice('Open the Content tab first — the editor has to be on screen to receive the link.')
      return
    }
    setNotice(null)
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">Internal links</p>
        <p className="text-xs text-muted-foreground">
          The hard part of internal linking is remembering what you have already written.
          Insert drops the link at the cursor in the editor.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search posts to link to"
          className="h-9 w-full rounded-lg border border-input bg-background ps-8 pe-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
        />
      </div>

      {notice && <p className="text-xs text-warning">{notice}</p>}

      {isError ? (
        <p className="text-xs text-muted-foreground">
          Suggestions are unavailable right now. You can still link by hand from the editor
          toolbar.
        </p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground">Looking for related posts…</p>
      ) : (suggestions ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing to suggest yet. Suggestions come from published posts that overlap this
          one&apos;s topic.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
          {(suggestions ?? []).map((suggestion) => {
            const alreadyLinked = existing.slugs.has(suggestion.slug)
            return (
              <li key={suggestion.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{suggestion.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    /blog/{suggestion.slug}
                    {suggestion.focusKeyword ? ` — ${suggestion.focusKeyword}` : ''}
                  </span>
                </div>
                <ElementButton
                  size="sm"
                  variant="outline"
                  disabled={disabled || alreadyLinked}
                  onClick={() => insert(suggestion)}
                >
                  <Link2 size={13} />
                  {alreadyLinked ? 'Linked' : 'Insert link'}
                </ElementButton>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold">
          Outbound internal links in this post ({existing.links.length})
        </p>
        {existing.links.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None yet. A post with no outbound internal links is a dead end for readers and for
            crawl depth alike.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {existing.links.map((link, index) => (
              <li key={`${link.href}-${index}`} className="truncate text-xs text-muted-foreground">
                <span className="text-foreground">{link.text || '(no anchor text)'}</span> → {link.href}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
