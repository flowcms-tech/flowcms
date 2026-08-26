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
import { AuthorServices } from './Services/AuthorServices'
import { buildColumns } from './Values/AuthorValues'
import AuthorCreateDrawer from './Components/AuthorCreateDrawer'
import AuthorEditDrawer from './Components/AuthorEditDrawer'
import type { Author } from './Types'

interface SearchForm {
  search: string
}

export default function AuthorsModule() {
  const queryClient = useQueryClient()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Author | null>(null)
  const [toggleTarget, setToggleTarget] = useState<Author | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Author | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const methods = useForm<SearchForm>({ defaultValues: { search: '' } })
  const search = methods.watch('search')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['authors-list', debouncedSearch],
    queryFn: () => AuthorServices.list(debouncedSearch || undefined),
  })

  const authors = data ?? []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['authors-list'] })

  const handleConfirmToggleActive = async () => {
    if (!toggleTarget) return
    setActionLoading(true)
    try {
      await AuthorServices.changeActive(toggleTarget.id, !toggleTarget.isActive)
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
      await AuthorServices.delete(deleteTarget.id)
      await invalidate()
    } catch {
      // The route returns 422 when the author still has posts; the global
      // error toast already explains it, so keep the modal open.
      return
    } finally {
      setActionLoading(false)
    }
    setDeleteTarget(null)
  }

  const columns = buildColumns(setEditTarget, setToggleTarget, setDeleteTarget)

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm">Authors</p>
        <ElementButton size="sm" onClick={() => setIsCreateOpen(true)}>
          <Plus size={15} />
          New Author
        </ElementButton>
      </div>
      <ElementFilterBar triggerLabel="Filters" activeCount={[debouncedSearch].filter(Boolean).length}>
        <FormProvider {...methods}>
          <form onSubmit={(e) => e.preventDefault()}>
            <ElementInput
              name="search"
              placeholder="Search by name or job title"
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
      <AuthorCreateDrawer
        isOpen={isCreateOpen}
        setIsOpen={setIsCreateOpen}
        onCreated={invalidate}
      />

      <AuthorEditDrawer
        isOpen={editTarget !== null}
        setIsOpen={(open) => { if (!open) setEditTarget(null) }}
        author={editTarget}
        onUpdated={invalidate}
      />

      <ElementModal.Confirm
        isOpen={toggleTarget !== null}
        onClose={(v) => { if (!v) setToggleTarget(null) }}
        variant="default"
        title={toggleTarget?.isActive ? 'Deactivate Author' : 'Activate Author'}
        description={
          toggleTarget
            ? toggleTarget.isActive
              ? `Deactivate "${toggleTarget.name}"? They stay credited on existing posts but can't be assigned to new ones.`
              : `Activate "${toggleTarget.name}" so they can be assigned to posts again?`
            : undefined
        }
        confirmText="Confirm"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmToggleActive}
      />

      <ElementModal.Confirm
        isOpen={deleteTarget !== null}
        onClose={(v) => { if (!v) setDeleteTarget(null) }}
        variant="danger"
        title="Delete Author"
        description={
          deleteTarget
            ? deleteTarget.postCount > 0
              ? `"${deleteTarget.name}" is credited on ${deleteTarget.postCount} post${deleteTarget.postCount === 1 ? '' : 's'} and can't be deleted. Deactivate them instead.`
              : `Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone.`
            : undefined
        }
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmDelete}
      />

      <ElementTable<Author>
        columns={columns}
        data={authors}
        loading={isLoading}
        loadingRows={5}
        headerContent={header}
        emptyContent={<p>No authors found</p>}
      />
    </>
  )
}
