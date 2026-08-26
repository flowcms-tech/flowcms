'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Monitor, Smartphone } from 'lucide-react'
import { SettingsServices } from '@/Modules/Settings/Services/SettingsServices'
import { renderMetaTemplate } from '@/Modules/Blog/Public/Values/metaTemplates'

/**
 * Google truncates a result on **pixel width**, not character count.
 *
 * "60 characters" is wrong for a title full of `W`s and wrong the other way for
 * one full of `l`s, which is the entire reason this component exists. Widths are
 * measured with `ctx.measureText` against the fonts Google renders results in.
 *
 * Desktop title is the documented 600 px at 20 px Arial. Descriptions get 920 px
 * at 14 px on both form factors. The mobile title container is narrower and
 * renders at 16 px — 480 px is the working figure; treat it as a close
 * approximation of a layout Google changes without telling anyone, not a
 * constant they publish.
 */
const LIMITS = {
  desktop: { titleFont: '20px Arial', titlePx: 600, descFont: '14px Arial', descPx: 920 },
  mobile: { titleFont: '16px Arial', titlePx: 480, descFont: '14px Arial', descPx: 920 },
} as const

/** Defaults mirrored from `getMetaTemplates()` in SettingsService. If those
 *  change, these must change with them — a preview that predicts a different
 *  title from the one the page emits is worse than no preview. */
const DEFAULT_TITLE_TEMPLATE = '%title% %sep% %sitename%'
const DEFAULT_DESCRIPTION_TEMPLATE = '%excerpt%'
const DEFAULT_SEPARATOR = '|'

let sharedContext: CanvasRenderingContext2D | null | undefined

/** One offscreen canvas for the whole panel — a fresh one per keystroke per
 *  field is a measurable amount of garbage for no benefit. `undefined` means
 *  "not tried yet", `null` means "tried and unavailable". */
function measureContext(): CanvasRenderingContext2D | null {
  if (sharedContext !== undefined) return sharedContext
  try {
    sharedContext = document.createElement('canvas').getContext('2d')
  } catch {
    sharedContext = null
  }
  return sharedContext
}

interface Measured {
  text: string
  truncated: boolean
  widthPx: number
  limitPx: number
  /** False when canvas was unavailable and the width is a character estimate.
   *  Surfaced in the UI: a silent downgrade to character counting is exactly
   *  the failure this component was built to avoid. */
  measured: boolean
}

/** Fallback when there is no canvas: 0.5 em per character is the rough average
 *  for Arial across mixed-case English. Deliberately crude, and labelled as an
 *  estimate wherever it is shown. */
function estimateWidth(text: string, font: string): number {
  const size = parseFloat(font) || 16
  return text.length * size * 0.5
}

function truncateToPixels(text: string, font: string, limitPx: number): Measured {
  const ctx = measureContext()
  const width = (value: string) => {
    if (!ctx) return estimateWidth(value, font)
    ctx.font = font
    return ctx.measureText(value).width
  }

  const full = width(text)
  if (full <= limitPx) {
    return { text, truncated: false, widthPx: Math.round(full), limitPx, measured: !!ctx }
  }

  // Binary search the longest prefix that still fits once the ellipsis is
  // accounted for — that is where Google puts the cut.
  const ellipsisWidth = width('…')
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (width(text.slice(0, mid)) + ellipsisWidth <= limitPx) low = mid
    else high = mid - 1
  }

  const clipped = text.slice(0, low).replace(/\s+\S*$/, '').trimEnd()
  return {
    text: `${clipped}…`,
    truncated: true,
    widthPx: Math.round(full),
    limitPx,
    measured: !!ctx,
  }
}

export interface SerpPreviewProps {
  title: string
  metaTitle?: string | null
  metaDescription?: string | null
  excerpt: string
  slug: string
  focusKeyword?: string | null
  primaryCategoryName?: string | null
  authorName?: string | null
  /** ISO date, or null on an unpublished post — the preview then dates it
   *  today, which is what Google will show on the day it goes live. */
  publishedAt?: string | null
}

export default function SerpPreview({
  title,
  metaTitle,
  metaDescription,
  excerpt,
  slug,
  focusKeyword,
  primaryCategoryName,
  authorName,
  publishedAt,
}: SerpPreviewProps) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')

  const { data: settings } = useQuery({
    queryKey: ['global-settings'],
    queryFn: () => SettingsServices.get(),
    staleTime: 5 * 60 * 1000,
  })

  const resolved = useMemo(() => {
    const separator = settings?.titleSeparator || DEFAULT_SEPARATOR
    const displayDate = publishedAt ? new Date(publishedAt) : new Date()
    const vars = {
      title,
      sitename: settings?.siteName || 'FlowCMS',
      sep: separator,
      excerpt,
      category: primaryCategoryName ?? '',
      primary_category: primaryCategoryName ?? '',
      author: authorName ?? '',
      focus_keyword: focusKeyword ?? '',
      date: displayDate.toLocaleDateString('en-CA'),
    }

    // Per-post values always win; the template only fills a blank. Showing the
    // RESOLVED title is the point — leaving metaTitle empty is the common case,
    // and a preview of an empty field would lie about it.
    const resolvedTitle =
      (metaTitle ?? '').trim() ||
      renderMetaTemplate(settings?.metaTitleTemplate || DEFAULT_TITLE_TEMPLATE, vars) ||
      title
    const resolvedDescription =
      (metaDescription ?? '').trim() ||
      renderMetaTemplate(settings?.metaDescriptionTemplate || DEFAULT_DESCRIPTION_TEMPLATE, vars) ||
      excerpt

    return {
      title: resolvedTitle,
      description: resolvedDescription,
      usedTitleTemplate: !(metaTitle ?? '').trim(),
      usedDescriptionTemplate: !(metaDescription ?? '').trim(),
      date: displayDate,
      base: settings?.baseUrl || 'https://flowcms.tech',
      siteName: settings?.siteName || 'FlowCMS',
    }
  }, [settings, title, metaTitle, metaDescription, excerpt, focusKeyword, primaryCategoryName, authorName, publishedAt])

  const limits = LIMITS[device]
  const measuredTitle = useMemo(
    () => truncateToPixels(resolved.title, limits.titleFont, limits.titlePx),
    [resolved.title, limits]
  )
  const measuredDescription = useMemo(
    () => truncateToPixels(resolved.description, limits.descFont, limits.descPx),
    [resolved.description, limits]
  )

  const host = resolved.base.replace(/^https?:\/\//, '').replace(/\/$/, '')

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Google result preview</p>
        <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
          {(['desktop', 'mobile'] as const).map((option) => {
            const Icon = option === 'desktop' ? Monitor : Smartphone
            return (
              <button
                key={option}
                type="button"
                onClick={() => setDevice(option)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  device === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon size={13} />
                {option}
              </button>
            )
          })}
        </div>
      </div>

      <div
        className="rounded-lg border border-border bg-background p-4"
        style={{ maxWidth: device === 'desktop' ? 660 : 420 }}
      >
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-full border border-border text-[10px] font-semibold">
            {resolved.siteName.charAt(0).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-xs text-foreground">{resolved.siteName}</span>
            <span className="truncate text-xs text-muted-foreground">
              {host} › blog › {slug || 'your-post-slug'}
            </span>
          </div>
        </div>

        <p
          className="mt-2 text-[#1a0dab] dark:text-[#8ab4f8]"
          style={{ fontFamily: 'Arial, sans-serif', fontSize: device === 'desktop' ? 20 : 16 }}
        >
          {measuredTitle.text || 'Your post title'}
        </p>

        <p
          className="mt-1 text-muted-foreground"
          style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, lineHeight: 1.45 }}
        >
          <span className="me-1">
            {resolved.date.toLocaleDateString('en-CA', { day: 'numeric', month: 'short', year: 'numeric' })} —
          </span>
          {measuredDescription.text || 'Your meta description will appear here.'}
        </p>
      </div>

      <div className="flex flex-col gap-1 text-xs">
        <PixelLine label="Title" measured={measuredTitle} />
        <PixelLine label="Description" measured={measuredDescription} />
        {(resolved.usedTitleTemplate || resolved.usedDescriptionTemplate) && (
          <p className="text-muted-foreground">
            {resolved.usedTitleTemplate && resolved.usedDescriptionTemplate
              ? 'Title and description are'
              : resolved.usedTitleTemplate
                ? 'Title is'
                : 'Description is'}{' '}
            filled from the site meta template — this is exactly what the page will emit.
          </p>
        )}
        {!measuredTitle.measured && (
          <p className="text-warning">
            Canvas is unavailable in this browser, so widths are estimated from character
            counts. The truncation point shown is approximate.
          </p>
        )}
      </div>
    </div>
  )
}

function PixelLine({ label, measured }: { label: string; measured: Measured }) {
  const over = measured.widthPx > measured.limitPx
  const wellUnder = measured.widthPx < measured.limitPx * 0.6
  return (
    <p className={over ? 'text-destructive' : wellUnder ? 'text-warning' : 'text-success'}>
      {label}: {measured.widthPx} px of {measured.limitPx} px
      {over
        ? ' — Google cuts it where the ellipsis is.'
        : wellUnder
          ? ' — there is room for more, and unused result space is wasted.'
          : ' — fits.'}
    </p>
  )
}
