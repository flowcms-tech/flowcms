'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFormContext, type FieldValues } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, Info, Minus, Plus, X } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import { SettingsServices } from '@/Modules/Settings/Services/SettingsServices'
import { analyseSeo, type SeoAnalysisInput, type SeoCheck } from '../Values/seoAnalysis'
import ReadabilityPanel from './ReadabilityPanel'

/** Long enough that a typist never triggers a recompute mid-word, short enough
 *  that the panel still feels live. `analyseSeo` walks the whole body, and on a
 *  2 000-word post that is real work to repeat on every keystroke. */
const ANALYSIS_DEBOUNCE_MS = 300

/**
 * Debounces an arbitrary value by structural identity.
 *
 * Keyed on the serialised form rather than the object reference, because the
 * caller builds a fresh `SeoAnalysisInput` object on every render — a reference
 * comparison would fire the timer every time and debounce nothing.
 */
function useDebounced<T>(value: T, delayMs: number): T {
  const serialised = JSON.stringify(value)
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialised, delayMs])

  return debounced
}

function ScoreRing({ score }: { score: number }) {
  const radius = 30
  const circumference = 2 * Math.PI * radius
  const tone = score >= 80 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-destructive'

  return (
    <div className="relative size-[76px] shrink-0">
      <svg viewBox="0 0 76 76" className="size-full -rotate-90">
        <circle cx="38" cy="38" r={radius} fill="none" strokeWidth="7" className="stroke-muted" />
        <circle
          cx="38"
          cy="38"
          r={radius}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className={`${tone} transition-[stroke-dashoffset] duration-500`}
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.max(0, Math.min(100, score)) / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-lg font-semibold leading-none ${tone}`}>{score}</span>
        <span className="text-[10px] text-muted-foreground">/ 100</span>
      </div>
    </div>
  )
}

const GROUPS: { status: SeoCheck['status']; label: string; tone: string; icon: typeof Check }[] = [
  { status: 'fail', label: 'Needs work', tone: 'text-destructive', icon: X },
  { status: 'warn', label: 'Worth a look', tone: 'text-warning', icon: AlertTriangle },
  { status: 'pass', label: 'Good', tone: 'text-success', icon: Check },
  { status: 'na', label: 'Not applicable', tone: 'text-muted-foreground', icon: Minus },
]

function CheckList({ checks }: { checks: SeoCheck[] }) {
  return (
    <div className="flex flex-col gap-4">
      {GROUPS.map((group) => {
        const rows = checks.filter((check) => check.status === group.status)
        if (rows.length === 0) return null
        const Icon = group.icon
        return (
          <div key={group.status} className="flex flex-col gap-2">
            <p className={`text-xs font-semibold uppercase tracking-wide ${group.tone}`}>
              {group.label} ({rows.length})
            </p>
            <ul className="flex flex-col gap-2">
              {rows.map((check) => (
                <li key={check.id} className="flex gap-2">
                  <Icon size={14} className={`mt-0.5 shrink-0 ${group.tone}`} />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium leading-snug">{check.label}</span>
                    {/* The detail says what to DO. That is the whole reason this
                        list is worth more than a percentage. */}
                    <span className="text-xs leading-snug text-muted-foreground">{check.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

interface SeoPanelProps {
  input: SeoAnalysisInput
}

export default function SeoPanel({ input }: SeoPanelProps) {
  const [view, setView] = useState<'seo' | 'readability'>('seo')
  const debouncedInput = useDebounced(input, ANALYSIS_DEBOUNCE_MS)

  // Resolved here rather than by every caller: without it the analyser can only
  // recognise root-relative hrefs as internal, so an editor who pasted a full
  // https://flowcms.tech/blog/... URL would be told the post has no internal links.
  const { data: settings } = useQuery({
    queryKey: ['global-settings'],
    queryFn: () => SettingsServices.get(),
    staleTime: 5 * 60 * 1000,
  })

  const analysis = useMemo(
    () => analyseSeo({ ...debouncedInput, baseUrl: debouncedInput.baseUrl ?? settings?.baseUrl }),
    [debouncedInput, settings?.baseUrl]
  )

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex items-start gap-4">
        <ScoreRing score={analysis.score} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="inline-flex w-fit rounded-lg border border-border bg-background p-0.5">
            {(['seo', 'readability'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setView(tab)}
                className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  view === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab === 'seo' ? 'SEO checks' : 'Readability'}
              </button>
            ))}
          </div>
          {/* Said out loud, in the UI, because Rank Math's worst habit is making
              a green light feel mandatory. Every rule below has a legitimate
              exception and none of them stop a save. */}
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <Info size={12} className="mt-0.5 shrink-0" />
            Advisory only — nothing here blocks saving or publishing. Ignore any check that
            does not fit what you are writing.
          </p>
        </div>
      </div>

      {view === 'seo' ? (
        <CheckList checks={analysis.checks} />
      ) : (
        <ReadabilityPanel html={debouncedInput.content} />
      )}
    </div>
  )
}

/**
 * Up to four supporting terms, as chips.
 *
 * Its own component rather than an `ElementSelect creatable` because these are
 * free text with no option list behind them — a select would imply the terms
 * come from somewhere, and there is nowhere for them to come from.
 */
export function SecondaryKeywordsField({ disabled }: { disabled?: boolean }) {
  // Plain watch/setValue rather than `useFieldArray`: these are bare strings,
  // and useFieldArray keys its rows off an injected object id that a primitive
  // array has nowhere to carry.
  const { watch, setValue } = useFormContext<FieldValues>()
  const keywords: string[] = watch('secondaryKeywords') ?? []
  const [draft, setDraft] = useState('')

  const atLimit = keywords.length >= 4

  function commit(next: string[]) {
    setValue('secondaryKeywords', next, { shouldValidate: true, shouldDirty: true })
  }

  function addDraft() {
    const value = draft.trim()
    // Silently ignoring a duplicate beats a validation error for something the
    // editor plainly did not mean to do twice.
    if (!value || atLimit || keywords.includes(value)) return
    commit([...keywords, value])
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium leading-none">Supporting Keywords</span>
      <div className="flex flex-wrap items-center gap-2">
        {keywords.map((keyword, index) => (
          <span
            key={`${keyword}-${index}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs"
          >
            {keyword}
            <button
              type="button"
              onClick={() => commit(keywords.filter((_, i) => i !== index))}
              disabled={disabled}
              className="text-muted-foreground transition-colors hover:text-destructive"
              title="Remove"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {!atLimit && (
          <span className="inline-flex items-center gap-1">
            <input
              value={draft}
              disabled={disabled}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter inside a post form would otherwise submit it.
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addDraft()
                }
              }}
              placeholder="Add a supporting term"
              className="h-8 w-48 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
            />
            <ElementButton size="sm" variant="outline" onClick={addDraft} disabled={disabled || !draft.trim()}>
              <Plus size={13} />
            </ElementButton>
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Up to four related terms this post should also turn up for. They are stored with the
        post but deliberately not scored — the checklist grades the single focus keyword, and
        four more gauges would just be four more things to game.
      </p>
    </div>
  )
}
