'use client'

import { useMemo } from 'react'
import { Lightbulb, MousePointerClick, Target } from 'lucide-react'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import { analyseContentGaps, type ContentGap, type ContentGapKind, type GapQueryRow } from '../Values/contentGaps'

interface GroupSpec {
  kind: ContentGapKind
  label: string
  blurb: string
  icon: typeof Target
}

/** Ordered by how much an edit is likely to be worth, not alphabetically. A
 *  missing section is the biggest opportunity; a snippet rewrite is the
 *  cheapest. */
const GROUPS: GroupSpec[] = [
  {
    kind: 'no-mention',
    label: 'Not covered on the page',
    blurb:
      'Google is showing this post for these searches even though the words are not on it. Each one is a section that could be written.',
    icon: Lightbulb,
  },
  {
    kind: 'striking-distance',
    label: 'Striking distance',
    blurb:
      'Already ranking at positions 5–20. These are the searches where a better answer on the page actually moves the needle.',
    icon: Target,
  },
  {
    kind: 'low-ctr',
    label: 'Seen but not clicked',
    blurb:
      'Ranking well and still being passed over. Nothing you add to the body can fix this — it is decided in the title and description.',
    icon: MousePointerClick,
  },
]

function GapCard({ gap }: { gap: ContentGap }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border bg-background p-3">
      <p className="text-sm font-medium leading-snug">{gap.headline}</p>
      {/* The evidence is the point. A suggestion with no numbers behind it is
          indistinguishable from a guess, and an editor is right to ignore it. */}
      <p className="text-xs leading-snug text-muted-foreground">{gap.evidence}</p>
    </li>
  )
}

export interface PostContentGapsProps {
  queries: GapQueryRow[]
  content: string
  title?: string
  metaDescription?: string
}

export default function PostContentGaps({ queries, content, title, metaDescription }: PostContentGapsProps) {
  const gaps = useMemo(
    () => analyseContentGaps({ queries, content, title, metaDescription }),
    [queries, content, title, metaDescription]
  )

  if (queries.length === 0) return null

  const populated = GROUPS.map((group) => ({
    ...group,
    items: gaps.filter((gap) => gap.kind === group.kind),
  })).filter((group) => group.items.length > 0)

  if (populated.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <p className="text-sm font-medium">Content gaps</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing stands out. Every query with meaningful impressions is either already
          covered on the page or already ranking well enough that an edit would not move it.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/20 p-4">
      <div>
        <p className="text-sm font-medium">Content gaps</p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          Suggestions drawn from what this page already ranks for, with the numbers
          attached. Nothing here edits the post — read the evidence and decide.
        </p>
      </div>

      {populated.map((group) => {
        const Icon = group.icon
        return (
          <div key={group.kind} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Icon size={14} className="shrink-0 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide">{group.label}</span>
              <ElementBadge variant="muted">{group.items.length}</ElementBadge>
            </div>
            <p className="text-xs leading-snug text-muted-foreground">{group.blurb}</p>
            <ul className="flex flex-col gap-2">
              {group.items.map((gap) => (
                <GapCard key={`${gap.kind}:${gap.query}`} gap={gap} />
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
