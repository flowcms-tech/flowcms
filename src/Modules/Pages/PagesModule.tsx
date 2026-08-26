'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Search, Plus } from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementFilterBar from '@/components/shared/ElementFilterBar/ElementFilterBar'
import { PageServices } from './Services/PageServices'
import { buildColumns } from './Values/PageValues'
import type { CustomPage } from './Types'

interface SearchForm {
  search: string
}

export default function PagesModule() {
  const adminHref = useAdminHref()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [toggleTarget, setToggleTarget] = useState<CustomPage | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CustomPage | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const methods = useForm<SearchForm>({ defaultValues: { search: '' } })
  const search = methods.watch('search')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['pages-list', debouncedSearch],
    queryFn: () => PageServices.list(debouncedSearch || undefined),
  })

  const pages = data ?? []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['pages-list'] })

  const handleConfirmTogglePublished = async () => {
    if (!toggleTarget) return
    setActionLoading(true)
    try {
      await PageServices.changePublished(toggleTarget.id, !toggleTarget.isPublished)
      await invalidate()
    } catch {
      return
    } finally {
      setActionLoading(false)
    }
    setToggleTarget(null)
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setActionLoading(true)
    try {
      await PageServices.delete(deleteTarget.id)
      await invalidate()
    } catch {
      return
    } finally {
      setActionLoading(false)
    }
    setDeleteTarget(null)
  }

  const columns = buildColumns(
    (row) => router.push(adminHref(`/pages/${row.id}/edit`)),
    setToggleTarget,
    setDeleteTarget,
  )

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm">Pages</p>
        <ElementButton size="sm" onClick={() => router.push(adminHref('/pages/create'))}>
          <Plus size={15} />
          New Page
        </ElementButton>
      </div>
      <ElementFilterBar triggerLabel="Filters" activeCount={[debouncedSearch].filter(Boolean).length}>
        <FormProvider {...methods}>
          <form onSubmit={(e) => e.preventDefault()}>
            <ElementInput
              name="search"
              placeholder="Search by title"
              startIcon={<Search size={15} />}
              clearable
              classNames={{ root: 'w-full md:w-72' }}
            />
          </form>
        </FormProvider>
      </ElementFilterBar>
    </div>
  )

  return (
    <>
      <ElementModal.Confirm
        isOpen={toggleTarget !== null}
        onClose={(v) => { if (!v) setToggleTarget(null) }}
        variant="default"
        title={toggleTarget?.isPublished ? 'Unpublish Page' : 'Publish Page'}
        description={
          toggleTarget
            ? `Are you sure you want to ${toggleTarget.isPublished ? 'unpublish' : 'publish'} "${toggleTarget.title}" (${toggleTarget.path})?`
            : undefined
        }
        confirmText="Confirm"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmTogglePublished}
      />

      <ElementModal.Confirm
        isOpen={deleteTarget !== null}
        onClose={(v) => { if (!v) setDeleteTarget(null) }}
        variant="danger"
        title="Delete Page"
        description={deleteTarget ? `Are you sure you want to delete "${deleteTarget.title}"? This action cannot be undone.` : undefined}
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmDelete}
      />

      <ElementTable<CustomPage>
        columns={columns}
        data={pages}
        loading={isLoading}
        loadingRows={5}
        headerContent={header}
        emptyContent={<p>No pages found</p>}
      />
    </>
  )
}
