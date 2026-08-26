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
import { updateIssueSchema, type UpdateIssueFormValues } from '../Values/Validations'
import { IssuesLogServices } from '../Services/IssuesLogServices'
import type { SearchConsoleIssue } from '../Types'

interface IssueEditDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  issue: SearchConsoleIssue | null
  onUpdated: (issue: SearchConsoleIssue) => void
}

function buildValues(issue: SearchConsoleIssue | null): UpdateIssueFormValues {
  return {
    type: issue?.type ?? 'manual_action',
    title: issue?.title ?? '',
    description: issue?.description ?? '',
    url: issue?.url ?? '',
    detectedAt: issue?.detectedAt ? issue.detectedAt.slice(0, 10) : '',
    status: issue?.status ?? 'open',
    notes: issue?.notes ?? '',
  }
}

export default function IssueEditDrawer({ isOpen, setIsOpen, issue, onUpdated }: IssueEditDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const methods = useForm<UpdateIssueFormValues>({
    resolver: zodResolver(updateIssueSchema),
    defaultValues: buildValues(null),
  })

  const { handleSubmit, reset, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (issue) reset(buildValues(issue))
  }, [issue, reset])

  function handleClose(open: boolean) {
    if (!open) setServerErrors([])
    setIsOpen(open)
  }

  const onSubmit = async (values: UpdateIssueFormValues) => {
    if (!issue) return
    setServerErrors([])
    try {
      const updated = await IssuesLogServices.update(issue.id, values)
      onUpdated(updated)
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
      headerLabel="Edit Issue"
      direction="left"
      size="md"
      footer={
        <ElementDrawerFooter>
          <ElementButton variant="cancel" onClick={() => handleClose(false)} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            Save Changes
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
          <ElementInput name="title" label="Title" required />
          <ElementTextArea name="description" label="Description" rows={3} />
          <ElementInput name="url" label="Affected URL (optional)" placeholder="Leave blank for a site-wide issue" />
          <ElementDatePicker
            name="detectedAt"
            label="Detected Date"
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
          <ElementTextArea name="notes" label="Notes" rows={3} />
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
