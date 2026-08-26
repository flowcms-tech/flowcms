'use client'

import { useMemo } from 'react'
import { analyseReadability, fleschBand } from '../Values/readability'

interface ReadabilityPanelProps {
  /** Post body HTML. The caller is expected to hand this over already
   *  debounced — `analyseReadability` walks the whole body and counting
   *  syllables on every keystroke is exactly the work the debounce exists to
   *  avoid. */
  html: string
}

/** Flesch runs 0–100 and the bands are fixed, so the meter is a plain
 *  proportional bar rather than another ring competing with the SEO score. */
function Meter({ value, max = 100, tone }: { value: number; max?: number; tone: string }) {
  const width = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
    </div>
  )
}

function MetricRow({
  label,
  value,
  target,
  ok,
  note,
}: {
  label: string
  value: string
  target: string
  ok: boolean
  note?: string
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/60 py-2 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm">{label}</span>
        <span className={`text-sm font-medium ${ok ? 'text-success' : 'text-warning'}`}>{value}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{target}</span>
      </div>
      {note && <p className="text-[11px] leading-snug text-muted-foreground">{note}</p>}
    </div>
  )
}

export default function ReadabilityPanel({ html }: ReadabilityPanelProps) {
  const result = useMemo(() => analyseReadability(html), [html])

  const band = fleschBand(result.fleschScore)
  const bandTone =
    result.fleschScore >= 60 ? 'bg-success' : result.fleschScore >= 50 ? 'bg-warning' : 'bg-destructive'

  if (result.wordCount === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Write some body content and the readability metrics appear here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The band leads, not the number. "Fairly easy" is something an editor
          can act on; "68.4" invites them to chase a decimal that the syllable
          heuristic cannot actually defend. */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold">{band} to read</span>
          <span className="text-xs text-muted-foreground">
            Flesch ≈ {Math.round(result.fleschScore)} / 100
          </span>
        </div>
        <Meter value={result.fleschScore} tone={bandTone} />
        <p className="text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium">Approximate.</span> Syllables are counted by vowel
          groups and sentences are split on punctuation, with no grammar behind either.
          Useful for comparing two drafts of the same post; not a number to quote.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-6">
        <MetricRow
          label="Long sentences"
          value={`${result.longSentencePercent} %`}
          target="Target: under 25 % over 20 words"
          ok={result.longSentencePercent < 25}
        />
        <MetricRow
          label="Long paragraphs"
          value={`${result.longParagraphPercent} %`}
          target="Target: under 20 % over 150 words"
          ok={result.longParagraphPercent < 20}
        />
        <MetricRow
          label="Passive voice"
          value={`≈ ${result.passiveVoicePercent} %`}
          target="Target: under 10 %"
          ok={result.passiveVoicePercent < 10}
          note="Approximate. Detected without a parser, so “was tired” and “is interested” count as passive when they are not. Read the flagged sentences before rewriting."
        />
        <MetricRow
          label="Transition words"
          value={`${result.transitionWordPercent} %`}
          target="Target: over 30 % of sentences"
          ok={result.transitionWordPercent >= 30}
        />
        <MetricRow
          label="Longest run without a heading"
          value={`${result.longestRunWithoutHeading} words`}
          target="Target: under 300 words"
          ok={result.longestRunWithoutHeading <= 300}
        />
        <MetricRow
          label="Length"
          value={`${result.wordCount} words`}
          target={`${result.sentenceCount} sentences`}
          ok
        />
      </div>

      <ul className="flex flex-col gap-2">
        {result.checks
          .filter((check) => check.status !== 'na')
          .map((check) => (
            <li key={check.id} className="flex gap-2 text-sm">
              <span
                className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                  check.status === 'pass'
                    ? 'bg-success'
                    : check.status === 'warn'
                      ? 'bg-warning'
                      : 'bg-destructive'
                }`}
              />
              <span>
                <span className="font-medium">{check.label}. </span>
                <span className="text-muted-foreground">{check.detail}</span>
              </span>
            </li>
          ))}
      </ul>
    </div>
  )
}
