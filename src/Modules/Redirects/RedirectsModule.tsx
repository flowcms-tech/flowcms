'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Plus } from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementFilterBar from '@/components/shared/ElementFilterBar/ElementFilterBar'
import { RedirectServices } from './Services/RedirectServices'
import { buildColumns } from './Values/RedirectValues'
import RedirectCreateDrawer from './Components/RedirectCreateDrawer'
import RedirectEditDrawer from './Components/RedirectEditDrawer'
import type { Redirect } from './Types'

interface SearchForm {
  search: string
}

export default function RedirectsModule() {
  const queryClient = useQueryClient()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Redirect | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Redirect | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const methods = useForm<SearchForm>({ defaultValues: { search: '' } })
  const search = methods.watch('search')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['redirects-list', debouncedSearch],
    queryFn: () => RedirectServices.list(debouncedSearch || undefined),
  })

  const redirectRows = data ?? []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['redirects-list'] })

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setActionLoading(true)
    try {
      await RedirectServices.delete(deleteTarget.id)
      await invalidate()
    } catch {
      return
    } finally {
      setActionLoading(false)
    }
    setDeleteTarget(null)
  }

  const columns = buildColumns(setEditTarget, setDeleteTarget)

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">Redirects</p>
          <p className="text-xs text-muted-foreground">
            Point an old blog URL somewhere else. Slug changes create these automatically —
            use this screen for anything you need to redirect by hand.
          </p>
        </div>
        <ElementButton size="sm" onClick={() => setIsCreateOpen(true)}>
          <Plus size={15} />
          New Redirect
        </ElementButton>
      </div>
      <ElementFilterBar triggerLabel="Filters" activeCount={[debouncedSearch].filter(Boolean).length}>
        <FormProvider {...methods}>
          <form onSubmit={(e) => e.preventDefault()}>
            <ElementInput
              name="search"
              placeholder="Search by path"
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
      <RedirectCreateDrawer
        isOpen={isCreateOpen}
        setIsOpen={setIsCreateOpen}
        onCreated={invalidate}
      />

      <RedirectEditDrawer
        isOpen={editTarget !== null}
        setIsOpen={(open) => { if (!open) setEditTarget(null) }}
        redirect={editTarget}
        onUpdated={invalidate}
      />

      <ElementModal.Confirm
        isOpen={deleteTarget !== null}
        onClose={(v) => { if (!v) setDeleteTarget(null) }}
        variant="danger"
        title="Delete Redirect"
        description={
          deleteTarget
            ? `Delete the redirect from "${deleteTarget.fromPath}"? Visitors and search engines hitting that URL will get a 404 again.`
            : undefined
        }
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmDelete}
      />

      <ElementTable<Redirect>
        columns={columns}
        data={redirectRows}
        loading={isLoading}
        loadingRows={5}
        headerContent={header}
        emptyContent={<p>No redirects yet</p>}
      />
    </>
  )
}
