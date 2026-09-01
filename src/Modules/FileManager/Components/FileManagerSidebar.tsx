'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderPlus, Home } from 'lucide-react'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import { FileManagerServices } from '../Services/FileManagerServices'
import FileManagerNameModal from './FileManagerNameModal'
import FileManagerTreeNode from './FileManagerTreeNode'
import FileManagerDirectoryPicker from './FileManagerDirectoryPicker'

interface FileManagerSidebarProps {
  selectedPrefix: string
  onSelect: (prefix: string) => void
}

export default function FileManagerSidebar({ selectedPrefix, onSelect }: FileManagerSidebarProps) {
  const queryClient = useQueryClient()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  // The target is a prefix; this is the bare name the dialog opens with.
  const [renameInitialName, setRenameInitialName] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)

  const [transferAction, setTransferAction] = useState<{ type: 'move' | 'copy'; prefix: string } | null>(null)
  const [isTransferring, setIsTransferring] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  function parentOf(prefix: string): string {
    const segments = prefix.split('/')
    const parentSegments = segments.slice(0, -2)
    return parentSegments.length > 0 ? `${parentSegments.join('/')}/` : ''
  }

  async function handleCreateDirectory(name: string) {
    setIsCreating(true)
    try {
      await FileManagerServices.createDirectory(selectedPrefix, name)
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', selectedPrefix] })
      setIsCreateOpen(false)
    } catch {
      // Global error toast (via the axios interceptor) already surfaced this.
    } finally {
      setIsCreating(false)
    }
  }

  function handleRequestRename(prefix: string, currentName: string) {
    setRenameTarget(prefix)
    setRenameInitialName(currentName)
  }

  async function handleConfirmRename(name: string) {
    if (!renameTarget) return
    setIsRenaming(true)
    try {
      const parent = parentOf(renameTarget)
      const newPrefix = `${parent}${name}/`

      await FileManagerServices.renameDirectory(renameTarget, name)
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', parent] })

      if (selectedPrefix === renameTarget || selectedPrefix.startsWith(renameTarget)) {
        onSelect(selectedPrefix.replace(renameTarget, newPrefix))
      }

      setRenameTarget(null)
    } catch {
      // Global error toast (via the axios interceptor) already surfaced this.
    } finally {
      setIsRenaming(false)
    }
  }

  async function handleConfirmTransfer(destination: string) {
    if (!transferAction) return
    setIsTransferring(true)
    try {
      const { type, prefix } = transferAction
      if (type === 'move') {
        await FileManagerServices.moveDirectory(prefix, destination)
      } else {
        await FileManagerServices.copyDirectory(prefix, destination)
      }

      const parent = parentOf(prefix)
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', parent] })
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', destination] })

      if (type === 'move' && (selectedPrefix === prefix || selectedPrefix.startsWith(prefix))) {
        const baseName = prefix.split('/').filter(Boolean).pop() ?? ''
        const newPrefix = `${destination}${baseName}/`
        onSelect(selectedPrefix.replace(prefix, newPrefix))
      }

      setTransferAction(null)
    } catch {
      // Global error toast (via the axios interceptor) already surfaced this.
    } finally {
      setIsTransferring(false)
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      const parent = parentOf(deleteTarget)

      await FileManagerServices.deleteDirectory(deleteTarget)
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', parent] })

      if (selectedPrefix === deleteTarget || selectedPrefix.startsWith(deleteTarget)) {
        onSelect(parent)
      }
    } catch {
      // Global error toast (via the axios interceptor) already surfaced this.
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 w-64 shrink-0 flex-col border-e border-border pe-3">
      <div className="flex shrink-0 items-center justify-between px-2 pb-2">
        <p className="text-sm font-semibold">Directories</p>
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          title="New Directory"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <FolderPlus size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto styled-scrollbar">
        <FileManagerTreeNode
          prefix=""
          name="Home"
          depth={0}
          selectedPrefix={selectedPrefix}
          onSelect={onSelect}
          onRequestRename={handleRequestRename}
          onRequestMove={(prefix) => setTransferAction({ type: 'move', prefix })}
          onRequestCopy={(prefix) => setTransferAction({ type: 'copy', prefix })}
          onRequestDelete={setDeleteTarget}
          icon={<Home size={14} className="shrink-0 text-muted-foreground" />}
          defaultExpanded
        />
      </div>

      {isCreateOpen && (
        <FileManagerNameModal
          title="New Directory"
          description={`Create a new directory inside "${selectedPrefix || 'Home'}".`}
          label="Directory name"
          placeholder="Directory name"
          confirmText="Create"
          isSubmitting={isCreating}
          onSubmit={handleCreateDirectory}
          onClose={() => setIsCreateOpen(false)}
        />
      )}

      {renameTarget !== null && (
        <FileManagerNameModal
          title="Rename Directory"
          description={`Rename "${renameTarget}".`}
          label="Directory name"
          placeholder="Directory name"
          defaultValue={renameInitialName}
          confirmText="Rename"
          isSubmitting={isRenaming}
          onSubmit={handleConfirmRename}
          onClose={() => setRenameTarget(null)}
        />
      )}

      <FileManagerDirectoryPicker
        isOpen={transferAction !== null}
        title={transferAction?.type === 'move' ? 'Move Directory' : 'Copy Directory'}
        confirmText={transferAction?.type === 'move' ? 'Move' : 'Copy'}
        isSubmitting={isTransferring}
        onClose={() => setTransferAction(null)}
        onConfirm={handleConfirmTransfer}
      />

      <ElementModal.Confirm
        isOpen={deleteTarget !== null}
        onClose={(open) => { if (!open) setDeleteTarget(null) }}
        variant="danger"
        title="Delete Directory"
        description={deleteTarget ? `Delete "${deleteTarget}" and everything inside it? This cannot be undone.` : undefined}
        confirmText="Delete"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}
