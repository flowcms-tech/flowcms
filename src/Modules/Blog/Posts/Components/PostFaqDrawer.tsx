'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementEditor from '@/components/shared/ElementEditor/ElementEditor'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { createFaqSchema, type CreateFaqFormValues } from '../Values/FaqValidations'

const FAQ_ANSWER_PLUGINS = ['link', 'lists', 'autolink']
const FAQ_ANSWER_TOOLBAR = 'bold italic | bullist numlist | link | removeformat'

interface PostFaqDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  faq: { question: string; answer: string } | null
  onSave: (values: CreateFaqFormValues) => Promise<void>
}

export default function PostFaqDrawer({ isOpen, setIsOpen, faq, onSave }: PostFaqDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const isEditing = faq !== null

  const methods = useForm<CreateFaqFormValues>({
    resolver: zodResolver(createFaqSchema),
    defaultValues: { question: '', answer: '' },
  })

  const { handleSubmit, reset, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (isOpen) {
      reset({ question: faq?.question ?? '', answer: faq?.answer ?? '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, faq])

  function handleClose(open: boolean) {
    if (!open) setServerErrors([])
    setIsOpen(open)
  }

  const onSubmit = async (values: CreateFaqFormValues) => {
    setServerErrors([])
    try {
      await onSave(values)
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
      headerLabel={isEditing ? 'Edit FAQ' : 'Create FAQ'}
      direction="left"
      size="md"
      footer={
        <ElementDrawerFooter>
          <ElementButton variant="cancel" onClick={() => handleClose(false)} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            {isEditing ? 'Save Changes' : 'Create FAQ'}
          </ElementButton>
        </ElementDrawerFooter>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <ValidationBox messages={serverErrors} />

          <ElementInput name="question" label="Question" placeholder="e.g. How do I reset a smart lock?" required />
          <ElementEditor
            name="answer"
            label="Answer"
            placeholder="Write the answer..."
            height={200}
            plugins={FAQ_ANSWER_PLUGINS}
            toolbar={FAQ_ANSWER_TOOLBAR}
            required
          />
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
