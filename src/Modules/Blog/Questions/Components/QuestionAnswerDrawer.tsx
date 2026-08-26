'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { answerQuestionFormSchema, type UpdateQuestionFormValues } from '../Values/Validations'
import { BlogQuestionServices } from '../Services/BlogQuestionServices'
import type { BlogQuestion } from '../Types'

interface QuestionAnswerDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  question: BlogQuestion | null
  onSaved: () => void
}

/**
 * Answer, publish, reject — one drawer, because they are one decision.
 *
 * The reader's question is shown read-only at the top rather than in a field:
 * it is what a stranger actually typed, and quietly rewording it before
 * publishing it as a FAQ would misrepresent them. Only the display name is
 * editable, and only so that obvious spam in a name doesn't force a reject on
 * an otherwise good question.
 */
export default function QuestionAnswerDrawer({
  isOpen,
  setIsOpen,
  question,
  onSaved,
}: QuestionAnswerDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const methods = useForm<UpdateQuestionFormValues>({
    resolver: zodResolver(answerQuestionFormSchema),
    defaultValues: { answer: '', status: 'pending', priority: '0', askerName: '' },
  })

  const { handleSubmit, reset, setValue, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (question) {
      reset({
        answer: question.answer ?? '',
        status: question.status,
        priority: String(question.priority),
        askerName: question.askerName ?? '',
      })
    }
    // Errors are cleared by handleClose and again on submit, not here — a
    // setState inside an effect triggers a cascading render for no gain, since
    // every open is preceded by a close that already cleared them.
  }, [question, reset])

  function handleClose(open: boolean) {
    if (!open) setServerErrors([])
    setIsOpen(open)
  }

  const submit = async (values: UpdateQuestionFormValues) => {
    if (!question) return
    setServerErrors([])
    try {
      await BlogQuestionServices.update(question.id, {
        answer: values.answer ?? '',
        status: values.status,
        priority: Number(values.priority),
        askerName: values.askerName ?? '',
      })
      onSaved()
      handleClose(false)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string | string[] } } }
      if (axiosErr.response?.status === 422) {
        const raw = axiosErr.response.data?.message
        setServerErrors(Array.isArray(raw) ? raw : raw ? [raw] : ['An error occurred'])
      } else {
        setServerErrors(['An error occurred'])
      }
    }
  }

  /** Curried so the status is set inside the click, not while rendering the
   *  button. Publishing is one action rather than "change a dropdown, then
   *  press Save" — the dropdown that would exist otherwise is the whole
   *  decision, and burying it under a generic Save is how questions get
   *  published unanswered. */
  const submitAs = (status: UpdateQuestionFormValues['status']) => async () => {
    setValue('status', status)
    await handleSubmit(submit)()
  }

  return (
    <ElementDrawer
      isOpen={isOpen}
      setIsOpen={handleClose}
      headerLabel="Answer reader question"
      direction="left"
      footer={
        <ElementDrawerFooter>
          <ElementButton variant="cancel" onClick={() => handleClose(false)} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton variant="outline" onClick={submitAs('rejected')} disabled={isSubmitting}>
            Reject
          </ElementButton>
          <ElementButton variant="outline" onClick={submitAs('pending')} disabled={isSubmitting}>
            Save draft
          </ElementButton>
          <ElementButton onClick={submitAs('published')} isLoading={isSubmitting}>
            Publish
          </ElementButton>
        </ElementDrawerFooter>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
          <ValidationBox messages={serverErrors} />

          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Reader asked
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{question?.question}</p>
            {question?.post && (
              <p className="mt-3 text-xs text-muted-foreground">On “{question.post.title}”</p>
            )}
          </div>

          <ElementInput
            name="askerName"
            label="Display name"
            placeholder="Anonymous"
            hint="Shown beside the published question. Leave blank to publish it unsigned."
          />

          <ElementTextArea
            name="answer"
            label="Answer"
            placeholder="Write the answer a reader will see on the post."
            rows={8}
            maxLength={4000}
            hint="Publishing needs an answer — a published question with no reply is refused by the API, not just by this form."
          />

          <ElementInput
            name="priority"
            type="number"
            label="Priority"
            hint="Lower numbers appear first, in the on-page Q&A block and in the FAQ structured data."
          />
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
