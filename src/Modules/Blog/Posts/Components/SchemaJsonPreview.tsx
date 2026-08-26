'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, Copy, ExternalLink } from 'lucide-react'
import { SettingsServices } from '@/Modules/Settings/Services/SettingsServices'
import type { SchemaType } from '../Values/Validations'
import { stripHtml } from '../Values/contentStats'

/** Google flags a longer headline. Same constant the server-side builder uses. */
const MAX_HEADLINE = 110

/** ISO 8601 with an explicit offset (or `Z`). A bare `2026-08-01T10:00:00` is
 *  ambiguous and Google resolves it against a timezone nobody chose. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const DATE_KEYS = new Set(['datePublished', 'dateModified', 'uploadDate'])
const URL_KEYS = new Set(['url', 'contentUrl', 'embedUrl', 'thumbnailUrl', 'item', 'image', 'sameAs'])

/** Properties Google treats as required for a rich result of each type. Only the
 *  ones it actually rejects on — an over-long list would train editors to
 *  ignore the whole box. */
const REQUIRED_BY_TYPE: Record<string, string[]> = {
  BlogPosting: ['headline', 'datePublished', 'author'],
  Article: ['headline', 'datePublished', 'author'],
  NewsArticle: ['headline', 'datePublished', 'author'],
  HowTo: ['name', 'step'],
  Review: ['itemReviewed', 'reviewRating', 'author'],
  VideoObject: ['name', 'description', 'thumbnailUrl', 'uploadDate'],
}

export interface SchemaJsonPreviewProps {
  slug: string
  title: string
  description: string
  canonicalUrl?: string | null
  publishedAt?: string | null
  contentUpdatedAt?: string | null
  authorName?: string | null
  primaryCategoryName?: string | null
  tagNames?: string[]
  /** Absolute URL of the resolved OG/featured image, when one is available. */
  imageUrl?: string | null
  schemaType: SchemaType
  schemaData: unknown
  /**
   * The post's FAQs, which become a `FAQPage` node alongside the main one.
   *
   * Passed in rather than fetched here so the Create form can feed its
   * not-yet-saved drafts through the same path the Edit form uses for saved
   * rows — a preview that only worked after the first save would be missing on
   * exactly the screen where the markup is being decided.
   */
  faqs?: { question: string; answer: string }[]
}

interface SchemaIssue {
  path: string
  message: string
}

/** Drops keys whose value is undefined, null, "" or an empty array. Google
 *  reports an empty-string property as an error, and there is never a reason
 *  to emit one. */
function compact(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    out[key] = value
  }
  return out
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : []
}

function buildGraph(props: SchemaJsonPreviewProps, base: string, siteName: string): Record<string, unknown> {
  const url = props.canonicalUrl?.trim() || `${base.replace(/\/$/, '')}/blog/${props.slug || 'your-post-slug'}`
  const orgId = `${base.replace(/\/$/, '')}/#organization`
  const published = props.publishedAt ? new Date(props.publishedAt).toISOString() : undefined
  const modified = props.contentUpdatedAt ? new Date(props.contentUpdatedAt).toISOString() : published

  const headline =
    props.title.length <= MAX_HEADLINE ? props.title : `${props.title.slice(0, MAX_HEADLINE - 1).trimEnd()}…`

  const main: Record<string, unknown> = {
    '@type': props.schemaType,
    '@id': `${url}#post`,
    headline,
    name: headline,
    description: props.description,
    image: props.imageUrl ? [props.imageUrl] : undefined,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: published,
    dateModified: modified,
    author: { '@type': 'Person', name: props.authorName || siteName },
    publisher: { '@id': orgId },
    articleSection: props.primaryCategoryName ?? undefined,
    keywords: props.tagNames?.length ? props.tagNames.join(', ') : undefined,
    inLanguage: 'en-CA',
    isAccessibleForFree: true,
  }

  const payload = asRecord(props.schemaData)

  if (props.schemaType === 'HowTo') {
    const steps = Array.isArray(payload.steps) ? (payload.steps as Record<string, unknown>[]) : []
    Object.assign(main, {
      totalTime: payload.totalTime || undefined,
      estimatedCost: payload.estimatedCost || undefined,
      tool: asStringArray(payload.tools).map((name) => ({ '@type': 'HowToTool', name })),
      supply: asStringArray(payload.supplies).map((name) => ({ '@type': 'HowToSupply', name })),
      step: steps.map((step, index) =>
        compact({
          '@type': 'HowToStep',
          position: index + 1,
          name: step.name,
          text: step.text,
          url: `${url}#step-${index + 1}`,
        })
      ),
    })
  }

  if (props.schemaType === 'Review') {
    Object.assign(main, {
      itemReviewed: compact({
        '@type': (payload.itemType as string) || 'Product',
        name: payload.itemName,
      }),
      reviewRating: compact({
        '@type': 'Rating',
        ratingValue: payload.rating,
        bestRating: payload.bestRating,
        worstRating: payload.worstRating,
      }),
      positiveNotes: asStringArray(payload.pros).length
        ? {
            '@type': 'ItemList',
            itemListElement: asStringArray(payload.pros).map((name, index) => ({
              '@type': 'ListItem',
              position: index + 1,
              name,
            })),
          }
        : undefined,
      negativeNotes: asStringArray(payload.cons).length
        ? {
            '@type': 'ItemList',
            itemListElement: asStringArray(payload.cons).map((name, index) => ({
              '@type': 'ListItem',
              position: index + 1,
              name,
            })),
          }
        : undefined,
    })
  }

  if (props.schemaType === 'VideoObject') {
    Object.assign(main, {
      contentUrl: payload.contentUrl,
      embedUrl: payload.embedUrl || undefined,
      uploadDate: payload.uploadDate ? new Date(payload.uploadDate as string).toISOString() : undefined,
      duration: payload.duration || undefined,
      thumbnailUrl: props.imageUrl ? [props.imageUrl] : undefined,
    })
  }

  // Mirrors buildPostJsonLd: ONE FAQPage node holding the curated FAQs (and,
  // on the live page, any published reader questions appended after them).
  // Answers are stripped to plain text because schema.org Answer.text must not
  // carry markup, and the FAQ editor is a rich-text field.
  const faqEntries = (props.faqs ?? []).filter((faq) => faq.question?.trim() && faq.answer?.trim())

  return {
    '@context': 'https://schema.org',
    '@graph': [
      compact({
        '@type': 'Organization',
        '@id': orgId,
        name: siteName,
        url: `${base.replace(/\/$/, '')}/`,
      }),
      compact(main),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${base.replace(/\/$/, '')}/` },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${base.replace(/\/$/, '')}/blog` },
          ...(props.primaryCategoryName
            ? [{ '@type': 'ListItem', position: 3, name: props.primaryCategoryName, item: url }]
            : []),
        ],
      },
      ...(faqEntries.length > 0
        ? [
            {
              '@type': 'FAQPage',
              '@id': `${url}#faq`,
              url,
              mainEntity: faqEntries.map((faq) => ({
                '@type': 'Question',
                name: stripHtml(faq.question),
                acceptedAnswer: { '@type': 'Answer', text: stripHtml(faq.answer) },
              })),
            },
          ]
        : []),
    ],
  }
}

/**
 * Local structural validation. Explicitly NOT a Google verdict — see the note
 * rendered under the button list.
 */
function validateGraph(graph: Record<string, unknown>): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  const definedIds = new Set<string>()
  const referencedIds: { id: string; path: string }[] = []

  function walk(value: unknown, path: string, isRefOnly: boolean) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, false))
      return
    }
    if (!value || typeof value !== 'object') return

    const node = value as Record<string, unknown>
    const keys = Object.keys(node)
    const id = typeof node['@id'] === 'string' ? (node['@id'] as string) : null

    // A node carrying only an @id is a reference to a node that must exist
    // somewhere else in the graph; one with other properties defines it.
    if (id) {
      if (keys.length === 1) referencedIds.push({ id, path })
      else definedIds.add(id)
    }

    const type = typeof node['@type'] === 'string' ? (node['@type'] as string) : null
    if (type && REQUIRED_BY_TYPE[type] && !isRefOnly) {
      for (const required of REQUIRED_BY_TYPE[type]) {
        const present = node[required]
        const empty =
          present === undefined ||
          present === null ||
          (typeof present === 'string' && !present.trim()) ||
          (Array.isArray(present) && present.length === 0)
        if (empty) issues.push({ path: `${path}.${required}`, message: `${type} requires "${required}".` })
      }
    }

    for (const [key, child] of Object.entries(node)) {
      const childPath = `${path}.${key}`

      if (typeof child === 'string') {
        if (!child.trim()) {
          issues.push({ path: childPath, message: 'Empty string — omit the property instead.' })
          continue
        }
        if (URL_KEYS.has(key) && !/^https?:\/\//i.test(child)) {
          issues.push({ path: childPath, message: 'URL must be absolute, including https://.' })
        }
        if (DATE_KEYS.has(key) && !ISO_WITH_OFFSET.test(child)) {
          issues.push({ path: childPath, message: 'Date must be ISO 8601 with an offset, e.g. 2026-08-01T09:00:00Z.' })
        }
        if (key === 'headline' && child.length > MAX_HEADLINE) {
          issues.push({ path: childPath, message: `Headline is ${child.length} characters; Google flags over ${MAX_HEADLINE}.` })
        }
        continue
      }

      walk(child, childPath, key === 'publisher' || key === 'mainEntityOfPage')
    }
  }

  walk(graph['@graph'], '@graph', false)

  for (const reference of referencedIds) {
    if (!definedIds.has(reference.id)) {
      issues.push({
        path: reference.path,
        message: `References @id "${reference.id}" but no node in the graph defines it.`,
      })
    }
  }

  return issues
}

export default function SchemaJsonPreview(props: SchemaJsonPreviewProps) {
  const [copied, setCopied] = useState(false)

  const { data: settings } = useQuery({
    queryKey: ['global-settings'],
    queryFn: () => SettingsServices.get(),
    staleTime: 5 * 60 * 1000,
  })

  const base = settings?.baseUrl || 'https://flowcms.tech'
  const siteName = settings?.siteName || 'FlowCMS'

  const graph = useMemo(() => buildGraph(props, base, siteName), [props, base, siteName])
  const json = useMemo(() => JSON.stringify(graph, null, 2), [graph])
  const issues = useMemo(() => validateGraph(graph), [graph])

  const pageUrl = props.canonicalUrl?.trim() || `${base.replace(/\/$/, '')}/blog/${props.slug || ''}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Structured data this post will emit</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
          >
            {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy JSON-LD'}
          </button>
          <a
            href={`https://search.google.com/test/rich-results?url=${encodeURIComponent(pageUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
          >
            <ExternalLink size={13} />
            Rich Results Test
          </a>
          <a
            href={`https://validator.schema.org/#url=${encodeURIComponent(pageUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
          >
            <ExternalLink size={13} />
            Schema.org validator
          </a>
        </div>
      </div>

      {/* Stated plainly, because tooling that implies a Google pass it never
          got is how markup ships broken. */}
      <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs leading-snug text-muted-foreground">
        <span className="font-medium text-foreground">There is no public Rich Results Test API.</span>{' '}
        The list below is a <strong>local</strong> structural check — required properties,
        absolute URLs, ISO dates, headline length, empty values, and dangling{' '}
        <code>@id</code> references. It is not a verdict from Google. The two links above open
        the real testers with this page&apos;s URL filled in, and those only work once the post is
        published and publicly reachable.
      </p>

      {issues.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <Check size={13} />
          No structural problems found locally.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {issues.map((issue) => (
            <li key={`${issue.path}-${issue.message}`} className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                <code className="text-[11px] text-muted-foreground">{issue.path}</code> — {issue.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-[11px] leading-relaxed styled-scrollbar">
        {json}
      </pre>
    </div>
  )
}
