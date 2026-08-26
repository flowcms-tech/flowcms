'use client'

import { useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import ElementDatePicker from '@/components/shared/ElementDatePicker/ElementDatePicker'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { createBusinessReviewFormSchema, type CreateBusinessReviewFormFields } from '../Values/Validations'
import { RATING_ITEMS } from '../Values/BusinessReviewValues'
import { BusinessReviewServices } from '../Services/BusinessReviewServices'
import type { BusinessReview } from '../Types'

interface BusinessReviewCreateDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  onCreated: (review: BusinessReview) => void
}

export default function BusinessReviewCreateDrawer({ isOpen, setIsOpen, onCreated }: BusinessReviewCreateDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const methods = useForm<CreateBusinessReviewFormFields>({
    resolver: zodResolver(createBusinessReviewFormSchema),
    // Unpublished by default. Publishing is what puts a review into the
    // structured data, so it is always a deliberate second action.
    defaultValues: {
      authorName: '', rating: '', body: '', source: '', sourceUrl: '', reviewedAt: '', isPublished: false,
    },
  })

  const { handleSubmit, reset, formState: { isSubmitting } } = methods

  function handleClose(open: boolean) {
    if (!open) {
      reset()
      setServerErrors([])
    }
    setIsOpen(open)
  }

  const onSubmit = async (values: CreateBusinessReviewFormFields) => {
    setServerErrors([])
    try {
      const created = await BusinessReviewServices.store({ ...values, rating: Number(values.rating) })
      onCreated(created)
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

  return (
    <ElementDrawer
      isOpen={isOpen}
      setIsOpen={handleClose}
      headerLabel="Add Review"
      direction="left"
      size="md"
      footer={
        <ElementDrawerFooter>
          <ElementButton variant="cancel" onClick={() => handleClose(false)} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            Add Review
          </ElementButton>
        </ElementDrawerFooter>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <ValidationBox messages={serverErrors} />

          <p className="rounded-lg border border-warning/40 bg-warning-light/40 p-3 text-xs text-foreground">
            Enter only reviews a real customer actually left. Once published, this row feeds the
            business&apos;s <code>AggregateRating</code> markup and is republished as a factual claim about
            the business.
          </p>

          <ElementInput name="authorName" label="Author Name" placeholder="e.g. Sarah M." required />

          <ElementSelect
            name="rating"
            label="Rating"
            placeholder="Select a rating"
            required
            items={RATING_ITEMS}
            hint="The star rating the customer gave. The site average is computed from these — it is never typed in by hand."
          />

          <ElementTextArea
            name="body"
            label="Review"
            placeholder="What the customer wrote, in their words."
            hint="Quote it, don't paraphrase. Published reviews render on the page as well as in the markup."
            maxLength={2000}
            rows={4}
          />

          <ElementInput
            name="source"
            label="Source"
            placeholder='e.g. Google, Facebook, collected directly'
            required
            hint="Where this review came from. Required — it is the audit trail behind the rating markup."
          />
          <ElementInput
            name="sourceUrl"
            label="Source URL"
            placeholder="https://…"
            hint="A link to the original, when there is one. Makes the review verifiable by anyone who asks."
          />

          <ElementDatePicker
            name="reviewedAt"
            label="Review Date"
            required
            disableFuture
            placeholder="Pick a date"
            hint="When the customer left it, not when you typed it in here."
          />

          <ElementCheckbox
            name="isPublished"
            label="Publish this review"
            hint="Published reviews render on the site and count towards the AggregateRating markup. Leave off until you have verified it is genuine."
          />
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
