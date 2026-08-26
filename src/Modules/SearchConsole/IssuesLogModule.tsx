'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Info, ShieldAlert } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import PaginatedDimensionTable from './Components/PaginatedDimensionTable'
import IssueCreateDrawer from './Components/IssueCreateDrawer'
import IssueEditDrawer from './Components/IssueEditDrawer'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { IssuesLogServices } from './Services/IssuesLogServices'
import type { SearchConsoleIssue } from './Types'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}

function typeBadge(type: SearchConsoleIssue['type']) {
  return type === 'security_issue' ? (
    <ElementBadge variant="destructive">Security Issue</ElementBadge>
  ) : (
    <ElementBadge variant="warning">Manual Action</ElementBadge>
  )
}

function statusBadge(status: SearchConsoleIssue['status']) {
  return status === 'resolved' ? (
    <ElementBadge variant="success">Resolved</ElementBadge>
  ) : (
    <ElementBadge variant="warning">Open</ElementBadge>
  )
}

export default function IssuesLogModule() {
  const queryClient = useQueryClient()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<SearchConsoleIssue | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SearchConsoleIssue | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['gsc-issues-log'],
    queryFn: () => IssuesLogServices.list(),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['gsc-issues-log'] })

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await IssuesLogServices.delete(deleteTarget.id)
      await invalidate()
      setDeleteTarget(null)
    } catch {
      return
    } finally {
      setIsDeleting(false)
    }
  }

  const issues = data ?? []

  const columns: ExtendedColumnDef<SearchConsoleIssue>[] = [
    {
      id: 'title',
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.title}</span>,
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => typeBadge(row.original.type),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => statusBadge(row.original.status),
    },
    {
      id: 'url',
      header: 'Affected URL',
      cell: ({ row }) =>
        row.original.url ? (
          <a
            href={row.original.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
          >
            {row.original.url}
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">Site-wide</span>
        ),
    },
    {
      id: 'detectedAt',
      header: 'Detected',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDate(row.original.detectedAt)}</span>,
    },
    {
      id: 'resolvedAt',
      header: 'Resolved',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDate(row.original.resolvedAt)}</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <ElementTableButton.edit title="Edit" onClick={() => setEditTarget(row.original)} />
          <ElementTableButton.delete title="Delete" onClick={() => setDeleteTarget(row.original)} />
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-5">
      <IssueCreateDrawer isOpen={isCreateOpen} setIsOpen={setIsCreateOpen} onCreated={invalidate} />
      <IssueEditDrawer
        isOpen={editTarget !== null}
        setIsOpen={(open) => { if (!open) setEditTarget(null) }}
        issue={editTarget}
        onUpdated={invalidate}
      />
      <ElementModal.Confirm
        isOpen={deleteTarget !== null}
        onClose={(v) => { if (!v) setDeleteTarget(null) }}
        variant="danger"
        title="Delete Issue"
        description={deleteTarget ? `Delete the logged issue "${deleteTarget.title}"? This only removes it from this tracking log.` : undefined}
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Issues Log</h1>
          <p className="text-sm text-muted-foreground">
            Manual tracking of Google Manual Actions and Security Issues.
          </p>
        </div>
        <ElementButton size="sm" onClick={() => setIsCreateOpen(true)}>
          <Plus size={15} />
          Log Issue
        </ElementButton>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0" />
        <p>
          Google exposes no API for Manual Actions or Security Issues, for anyone — this is not
          automated. Check the real Search Console UI periodically and log what you find here so
          the history and resolution status live somewhere other than someone&apos;s memory.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : issues.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
          <ShieldAlert size={22} className="text-muted-foreground" />
          <p className="text-sm font-medium">No issues logged</p>
          <p className="max-w-md text-xs leading-snug text-muted-foreground">
            Nothing tracked yet. Log one after checking Manual Actions or Security Issues in the
            real Search Console UI.
          </p>
        </div>
      ) : (
        <PaginatedDimensionTable<SearchConsoleIssue>
          columns={columns}
          rows={issues}
          emptyContent={<p>No issues logged.</p>}
          expandedRowContent={(row) => (
            <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
              {row.original.description && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-muted-foreground">Description</span>
                  <span className="text-sm">{row.original.description}</span>
                </div>
              )}
              {row.original.notes && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-muted-foreground">Notes</span>
                  <span className="text-sm">{row.original.notes}</span>
                </div>
              )}
            </div>
          )}
        />
      )}
    </div>
  )
}
