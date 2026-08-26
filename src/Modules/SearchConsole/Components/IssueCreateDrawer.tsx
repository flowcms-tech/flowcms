'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementDatePicker from '@/components/shared/ElementDatePicker/ElementDatePicker'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { createIssueSchema, type CreateIssueFormValues } from '../Values/Validations'
import { IssuesLogServices } from '../Services/IssuesLogServices'
import type { SearchConsoleIssue } from '../Types'

interface IssueCreateDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  onCreated: (issue: SearchConsoleIssue) => void
}

function buildEmpty(): CreateIssueFormValues {
  return { type: 'manual_action', title: '', description: '', url: '', detectedAt: '', status: 'open', notes: '' }
}

export default function IssueCreateDrawer({ isOpen, setIsOpen, onCreated }: IssueCreateDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const methods = useForm<CreateIssueFormValues>({
    resolver: zodResolver(createIssueSchema),
    defaultValues: buildEmpty(),
  })

  const { handleSubmit, reset, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (isOpen) reset(buildEmpty())
  }, [isOpen, reset])

  function handleClose(open: boolean) {
    if (!open) {
      reset(buildEmpty())
      setServerErrors([])
    }
    setIsOpen(open)
  }

  const onSubmit = async (values: CreateIssueFormValues) => {
    setServerErrors([])
    try {
      const created = await IssuesLogServices.store(values)
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
      headerLabel="Log an Issue"
      direction="left"
      size="md"
      footer={
        <ElementDrawerFooter>
          <ElementButton variant="cancel" onClick={() => handleClose(false)} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            Log Issue
          </ElementButton>
        </ElementDrawerFooter>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <ValidationBox messages={serverErrors} />

          <ElementSelect
            name="type"
            label="Type"
            items={[
              { label: 'Manual Action', value: 'manual_action' },
              { label: 'Security Issue', value: 'security_issue' },
            ]}
          />
          <ElementInput
            name="title"
            label="Title"
            placeholder="e.g. Unnatural links to your site"
            required
          />
          <ElementTextArea
            name="description"
            label="Description"
            placeholder="What Search Console reported"
            rows={3}
          />
          <ElementInput
            name="url"
            label="Affected URL (optional)"
            placeholder="Leave blank for a site-wide issue"
          />
          <ElementDatePicker
            name="detectedAt"
            label="Detected Date"
            placeholder="When Search Console flagged this"
            hint="Leave blank if unknown."
          />
          <ElementSelect
            name="status"
            label="Status"
            items={[
              { label: 'Open', value: 'open' },
              { label: 'Resolved', value: 'resolved' },
            ]}
          />
          <ElementTextArea
            name="notes"
            label="Notes"
            placeholder="What was done, or what's still pending"
            rows={3}
          />
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
