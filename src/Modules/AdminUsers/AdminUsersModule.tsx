'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Plus } from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementFilterBar from '@/components/shared/ElementFilterBar/ElementFilterBar'
import { AdminUsersServices } from './Services/AdminUsersServices'
import { buildColumns } from './Values/AdminUsersValues'
import AdminUserCreateDrawer from './Components/AdminUserCreateDrawer'
import AdminUserEditDrawer from './Components/AdminUserEditDrawer'
import { canManageUsers, type Role } from '@/Framework/Auth/permissions'
import type { AdminUser } from './Types'

interface SearchForm {
  search: string
}

const PAGE_SIZE = 10

interface AdminUsersModuleProps {
  /** Resolved server-side by the page. Used only to shape the form — every
   *  rule it implies is re-checked by /api/admin-users. */
  currentUserId: string
  currentRole: Role
}

export default function AdminUsersModule({ currentUserId, currentRole }: AdminUsersModuleProps) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null)
  const [toggleTarget, setToggleTarget] = useState<AdminUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const urlSearch = searchParams.get('search') ?? ''
  const urlPage   = Math.max(1, Number(searchParams.get('page') ?? '1'))

  const methods = useForm<SearchForm>({
    defaultValues: { search: urlSearch },
  })

  const searchValue = methods.watch('search')

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (searchValue) { params.set('search', searchValue) } else { params.delete('search') }
      params.delete('page')
      router.replace(`${pathname}?${params.toString()}`)
    }, 400)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue])

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users-list', urlSearch, urlPage],
    queryFn: () => AdminUsersServices.list({
      search: urlSearch || undefined,
      page:   urlPage,
    }),
  })

  const adminUsers = data?.data ?? []
  const total      = data?.total ?? 0
  const startIndex = (urlPage - 1) * PAGE_SIZE

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-users-list'] })

  const handleConfirmToggleActive = async () => {
    if (!toggleTarget) return
    setActionLoading(true)
    try {
      await AdminUsersServices.changeActive(toggleTarget.id, !toggleTarget.isActive)
      await invalidate()
    } catch {
      // Global error toast (via the axios interceptor) already surfaced this.
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
      await AdminUsersServices.delete(deleteTarget.id)
      await invalidate()
    } catch {
      // Global error toast (via the axios interceptor) already surfaced this.
      return
    } finally {
      setActionLoading(false)
    }
    setDeleteTarget(null)
  }

  const columns = buildColumns(startIndex, setEditTarget, setToggleTarget, setDeleteTarget)

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm">Admin Users</p>
        {/* Hidden, not disabled — an editor has no path to this screen anyway,
            and the route refuses the call regardless of what the UI shows. */}
        {canManageUsers(currentRole) && (
          <ElementButton size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus size={15} />
            New User
          </ElementButton>
        )}
      </div>
      <ElementFilterBar triggerLabel="Filters" activeCount={[urlSearch].filter(Boolean).length}>
        <FormProvider {...methods}>
          <form onSubmit={(e) => e.preventDefault()}>
            <ElementInput
              name="search"
              placeholder="Search by name, username, or email"
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
      <AdminUserCreateDrawer
        isOpen={isCreateOpen}
        setIsOpen={setIsCreateOpen}
        onCreated={invalidate}
        actorRole={currentRole}
      />

      <AdminUserEditDrawer
        isOpen={editTarget !== null}
        setIsOpen={(open) => { if (!open) setEditTarget(null) }}
        user={editTarget}
        onUpdated={invalidate}
        actorRole={currentRole}
        actorId={currentUserId}
      />

      <ElementModal.Confirm
        isOpen={toggleTarget !== null}
        onClose={(v) => { if (!v) setToggleTarget(null) }}
        variant="default"
        title={toggleTarget?.isActive ? 'Deactivate User' : 'Activate User'}
        description={
          toggleTarget
            ? `Are you sure you want to ${toggleTarget.isActive ? 'deactivate' : 'activate'} user "${toggleTarget.name}"?`
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
        title="Delete Admin User"
        description={deleteTarget ? `Are you sure you want to delete user "${deleteTarget.name}"? This action cannot be undone.` : undefined}
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmDelete}
      />

      <ElementTable<AdminUser>
        columns={columns}
        data={adminUsers}
        loading={isLoading}
        loadingRows={5}
        headerContent={header}
        emptyContent={<p>No admin users found</p>}
        totalCount={total}
        pageSize={PAGE_SIZE}
        syncSortWithUrl
      />
    </>
  )
}
