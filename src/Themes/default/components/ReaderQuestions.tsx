import type { PublicPostQuestion } from "@/Themes/contract"

interface ReaderQuestionsProps {
  questions: PublicPostQuestion[]
}

/**
 * The published Q&A block.
 *
 * This must render wherever the FAQPage markup includes these entries — the
 * same rule the hand-authored FAQs and the HowTo steps follow. Structured data
 * describing content a visitor cannot see is a manual-action risk, not a
 * shortcut, so the markup builder and this component read the same list and
 * neither is optional when the other runs.
 *
 * A `<dl>` for the same reason the FAQ block uses one: the question/answer
 * relationship is the content, and a pile of divs throws it away for anything
 * that isn't a sighted reader.
 */
export default function ReaderQuestions({ questions }: ReaderQuestionsProps) {
  if (questions.length === 0) return null

  return (
    <section className="mt-12" aria-labelledby="reader-questions-heading">
      <h2 id="reader-questions-heading" className="mb-4 text-xl font-semibold">
        Questions from readers
      </h2>
      <dl className="flex flex-col gap-3">
        {questions.map((entry) => (
          <div key={entry.id} className="rounded-lg border border-border p-4">
            <dt className="font-medium">{entry.question}</dt>
            <dd className="mt-2 text-sm text-muted-foreground">{entry.answer}</dd>
            {entry.askerName && (
              <p className="mt-2 text-xs text-muted-foreground">Asked by {entry.askerName}</p>
            )}
          </div>
        ))}
      </dl>
    </section>
  )
}
