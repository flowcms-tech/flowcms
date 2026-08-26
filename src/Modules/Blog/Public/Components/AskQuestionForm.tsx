'use client'

import { useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2 } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementCaptcha from '@/components/shared/ElementCaptcha/ElementCaptcha'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  createPublicQuestionSchema,
  type CreatePublicQuestionValues,
} from '@/Modules/Blog/Questions/Values/Validations'

interface AskQuestionFormProps {
  postId: string
  className?: string
}

/**
 * The reader-facing question box.
 *
 * Deliberately not a comment form. There is no thread, no reply-to, and no
 * email field: collecting an address implies a reply this app has no mail
 * infrastructure to send, and the honest thing is to say so rather than to
 * collect one and quietly do nothing with it.
 *
 * The success state is worded to promise exactly what happens — moderation,
 * possible publication, no personal reply. Anything warmer would be a promise
 * the system cannot keep.
 *
 * It brings its own TooltipProvider. The Element* inputs it is built from use
 * Radix tooltips, which throw outright without a provider in scope, and until
 * Phase 6.1 the only thing supplying one was the root layout — so this
 * component happened to work for the reason that it was always rendered
 * underneath the admin panel's provider. That is not a property a theme can
 * rely on: this form is exported through the theme contract, a theme decides
 * where to place it, and "renders fine unless you move it" is a trap to leave
 * for someone. Nesting providers is supported and costs nothing.
 */
export default function AskQuestionForm({ postId, className }: AskQuestionFormProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [isSent, setIsSent] = useState(false)
  const [captchaKey, setCaptchaKey] = useState(0)

  const methods = useForm<CreatePublicQuestionValues>({
    resolver: zodResolver(createPublicQuestionSchema),
    defaultValues: { postId, askerName: '', question: '', captchaCode: '', website: '' },
  })

  const { handleSubmit, reset, setValue, formState: { isSubmitting } } = methods

  const resetCaptcha = () => {
    setCaptchaKey((key) => key + 1)
    setValue('captchaCode', '')
  }

  const onSubmit = async (values: CreatePublicQuestionValues) => {
    setServerErrors([])
    try {
      const res = await fetch('/api/public/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Plain fetch rather than BAPI: BAPI carries the admin panel's global
        // toasts and error interceptor, neither of which belongs on a public
        // marketing page.
        credentials: 'include',
        body: JSON.stringify(values),
      })

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
        const raw = payload?.message
        setServerErrors(Array.isArray(raw) ? raw : raw ? [raw] : ['Something went wrong. Please try again.'])
        // The captcha is single-use whatever the outcome, so a retry always
        // needs a fresh code — leaving the old image up guarantees a second
        // failure that looks like the reader's mistake.
        resetCaptcha()
        return
      }

      reset({ postId, askerName: '', question: '', captchaCode: '', website: '' })
      setIsSent(true)
    } catch {
      setServerErrors(['Something went wrong. Please try again.'])
      resetCaptcha()
    }
  }

  if (isSent) {
    return (
      <div
        className={`flex items-start gap-3 rounded-lg border border-success/40 bg-success-light p-4 text-success ${className ?? ''}`}
        role="status"
      >
        <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium">Thanks — we have your question.</p>
          <p className="mt-1 text-xs opacity-90">
            We read every one. If it is useful to other readers, the answer will appear on
            this page. We can&apos;t reply to you directly — if you need help now, please call us.
          </p>
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={0}>
    <section className={className} aria-labelledby="ask-question-heading">
      <h2 id="ask-question-heading" className="mb-2 text-xl font-semibold">
        Ask a question about this
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Questions are read by a person and answered here on the page. We don&apos;t collect
        your email, so we can&apos;t reply privately.
      </p>

      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <ValidationBox messages={serverErrors} />

          <ElementInput
            name="askerName"
            label="Your name"
            placeholder="Optional"
            hint="Shown beside your question if we publish it. Leave blank to stay anonymous."
          />

          <ElementTextArea
            name="question"
            label="Your question"
            placeholder="What would you like to know?"
            rows={4}
            maxLength={1000}
            required
          />

          {/* Honeypot. Hidden from people and from screen readers, left in the
              tab order's way for nobody — a bot that fills every input trips it
              and gets a success response it can learn nothing from. */}
          <div className="hidden" aria-hidden="true">
            <ElementInput name="website" label="Website" />
          </div>

          <ElementCaptcha
            name="captchaCode"
            label="Security code"
            required
            resetKey={captchaKey}
            classNames={{
              image: 'h-10 rounded-lg border border-input select-none',
              refreshButton:
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            }}
          />

          <ElementButton type="submit" isLoading={isSubmitting} className="w-full sm:w-auto">
            Send question
          </ElementButton>
        </form>
      </FormProvider>
    </section>
    </TooltipProvider>
  )
}
