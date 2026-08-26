'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FolderInput, LayoutGrid, List, Trash2, Upload } from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementToast from '@/components/shared/ElementToast/ElementToast'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import { Input } from '@/components/ui/input'
import { isAllowedFileType, ALLOWED_FILE_ACCEPT_ATTRIBUTE } from '@/Framework/Functions/FileValidation'
import { FileManagerServices } from './Services/FileManagerServices'
import { buildColumns } from './Values/FileManagerValues'
import FileManagerSidebar from './Components/FileManagerSidebar'
import FileManagerBreadcrumb from './Components/FileManagerBreadcrumb'
import FileManagerUploadQueue, { type UploadQueueItem } from './Components/FileManagerUploadQueue'
import FileManagerUploadConflictModal from './Components/FileManagerUploadConflictModal'
import FileManagerDirectoryPicker from './Components/FileManagerDirectoryPicker'
import FileManagerFileGrid from './Components/FileManagerFileGrid'
import type { FileManagerItem } from './Types'

type ViewMode = 'list' | 'grid'

interface PendingUpload {
  files: File[]
  conflictNames: string[]
}

interface FileTransferAction {
  type: 'move' | 'copy'
  file: FileManagerItem
}

interface BulkTransferAction {
  type: 'move' | 'copy'
  files: FileManagerItem[]
  clearSelection: () => void
}

interface BulkDeleteAction {
  files: FileManagerItem[]
  clearSelection: () => void
}

export default function FileManagerModule() {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)
  const removalTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [selectedPrefix, setSelectedPrefix] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([])
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null)
  const [fileRenameTarget, setFileRenameTarget] = useState<FileManagerItem | null>(null)
  const [fileRenameValue, setFileRenameValue] = useState('')
  const [isFileRenaming, setIsFileRenaming] = useState(false)
  const [fileTransferAction, setFileTransferAction] = useState<FileTransferAction | null>(null)
  const [isFileTransferring, setIsFileTransferring] = useState(false)
  const [fileDeleteTarget, setFileDeleteTarget] = useState<FileManagerItem | null>(null)
  const [isFileDeleting, setIsFileDeleting] = useState(false)
  const [bulkTransferAction, setBulkTransferAction] = useState<BulkTransferAction | null>(null)
  const [isBulkTransferring, setIsBulkTransferring] = useState(false)
  const [bulkDeleteAction, setBulkDeleteAction] = useState<BulkDeleteAction | null>(null)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)

  useEffect(() => {
    const timers = removalTimers.current
    return () => { timers.forEach(clearTimeout) }
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['file-manager-dir', selectedPrefix],
    queryFn: () => FileManagerServices.listDirectory(selectedPrefix),
  })

  const files = data?.files ?? []

  function handleRequestFileRename(file: FileManagerItem) {
    setFileRenameTarget(file)
    setFileRenameValue(file.name)
  }

  function handleRequestFileMove(file: FileManagerItem) {
    setFileTransferAction({ type: 'move', file })
  }

  function handleRequestFileCopy(file: FileManagerItem) {
    setFileTransferAction({ type: 'copy', file })
  }

  function handleRequestFileDelete(file: FileManagerItem) {
    setFileDeleteTarget(file)
  }

  const columns = buildColumns(handleRequestFileRename, handleRequestFileMove, handleRequestFileCopy, handleRequestFileDelete)

  async function handleConfirmFileRename() {
    if (!fileRenameTarget) return
    const trimmed = fileRenameValue.trim()
    if (!isAllowedFileType(trimmed)) {
      ElementToast.error('This file type is not allowed.')
      return
    }
    setIsFileRenaming(true)
    try {
      await FileManagerServices.renameFile(fileRenameTarget.id, trimmed)
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', selectedPrefix] })
      setFileRenameTarget(null)
      setFileRenameValue('')
    } catch {
      // Global error toast (via the axios interceptor) already surfaced this.
    } finally {
      setIsFileRenaming(false)
    }
  }

  async function handleConfirmFileTransfer(destination: string) {
    if (!fileTransferAction) return
    setIsFileTransferring(true)
    try {
      const { type, file } = fileTransferAction
      if (type === 'move') {
        await FileManagerServices.moveFile(file.id, destination)
      } else {
        await FileManagerServices.copyFile(file.id, destination)
      }
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', selectedPrefix] })
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', destination] })
      setFileTransferAction(null)
    } catch {
      // Global error toast (via the axios interceptor) already surfaced this.
    } finally {
      setIsFileTransferring(false)
    }
  }

  async function handleConfirmFileDelete() {
    if (!fileDeleteTarget) return
    setIsFileDeleting(true)
    try {
      await FileManagerServices.deleteFile(fileDeleteTarget.id)
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', selectedPrefix] })
    } catch {
      // Global error toast (via the axios interceptor) already surfaced this.
    } finally {
      setIsFileDeleting(false)
      setFileDeleteTarget(null)
    }
  }

  async function handleConfirmBulkTransfer(destination: string) {
    if (!bulkTransferAction) return
    setIsBulkTransferring(true)
    try {
      const { type, files: targetFiles } = bulkTransferAction
      await Promise.all(
        targetFiles.map(async (file) => {
          try {
            if (type === 'move') {
              await FileManagerServices.moveFile(file.id, destination)
            } else {
              await FileManagerServices.copyFile(file.id, destination)
            }
          } catch {
            // Global error toast (via the axios interceptor) already surfaced this.
          }
        })
      )
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', selectedPrefix] })
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', destination] })
      bulkTransferAction.clearSelection()
      setBulkTransferAction(null)
      setIsBulkTransferring(false)
    }
  }

  async function handleConfirmBulkDelete() {
    if (!bulkDeleteAction) return
    setIsBulkDeleting(true)
    try {
      await Promise.all(
        bulkDeleteAction.files.map(async (file) => {
          try {
            await FileManagerServices.deleteFile(file.id)
          } catch {
            // Global error toast (via the axios interceptor) already surfaced this.
          }
        })
      )
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', selectedPrefix] })
      bulkDeleteAction.clearSelection()
      setBulkDeleteAction(null)
      setIsBulkDeleting(false)
    }
  }

  function renderBulkActions(selected: FileManagerItem[], clearSelection: () => void) {
    return (
      <div className="flex items-center gap-2">
        <ElementButton
          variant="outline"
          size="sm"
          onClick={() => setBulkTransferAction({ type: 'move', files: selected, clearSelection })}
        >
          <FolderInput size={14} />
          Move
        </ElementButton>
        <ElementButton
          variant="outline"
          size="sm"
          onClick={() => setBulkTransferAction({ type: 'copy', files: selected, clearSelection })}
        >
          <Copy size={14} />
          Copy
        </ElementButton>
        <ElementButton
          variant="destructive"
          size="sm"
          onClick={() => setBulkDeleteAction({ files: selected, clearSelection })}
        >
          <Trash2 size={14} />
          Delete
        </ElementButton>
      </div>
    )
  }

  function scheduleQueueRemoval(id: string, delay: number) {
    const timer = setTimeout(() => {
      setUploadQueue((prev) => prev.filter((item) => item.id !== id))
    }, delay)
    removalTimers.current.push(timer)
  }

  async function proceedUpload(filesToUpload: File[]) {
    if (filesToUpload.length === 0) return

    const queueItems: UploadQueueItem[] = filesToUpload.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      progress: 0,
      status: 'uploading',
    }))
    setUploadQueue((prev) => [...prev, ...queueItems])

    try {
      await Promise.all(
        filesToUpload.map(async (file, index) => {
          const queueId = queueItems[index].id
          try {
            await FileManagerServices.upload(file, selectedPrefix, (percent) => {
              setUploadQueue((prev) =>
                prev.map((item) => (item.id === queueId ? { ...item, progress: percent } : item))
              )
            })
            setUploadQueue((prev) =>
              prev.map((item) => (item.id === queueId ? { ...item, progress: 100, status: 'done' } : item))
            )
            scheduleQueueRemoval(queueId, 2000)
          } catch {
            // Global error toast (via the axios interceptor) already surfaced this.
            setUploadQueue((prev) =>
              prev.map((item) => (item.id === queueId ? { ...item, status: 'error' } : item))
            )
            scheduleQueueRemoval(queueId, 4000)
          }
        })
      )
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', selectedPrefix] })
    }
  }

  async function uploadFiles(fileList: FileList) {
    const incoming = Array.from(fileList)
    if (incoming.length === 0) return

    const validFiles = incoming.filter((file) => isAllowedFileType(file.name))
    const invalidFiles = incoming.filter((file) => !isAllowedFileType(file.name))

    if (invalidFiles.length > 0) {
      ElementToast.error(
        invalidFiles.length === 1
          ? `"${invalidFiles[0].name}" is not an allowed file type.`
          : `${invalidFiles.length} files were not allowed file types.`
      )
    }

    if (validFiles.length === 0) return

    const existingNames = new Set(files.map((f) => f.name))
    const conflictNames = validFiles
      .filter((file) => existingNames.has(file.name))
      .map((file) => file.name)

    if (conflictNames.length > 0) {
      setPendingUpload({ files: validFiles, conflictNames })
      return
    }

    await proceedUpload(validFiles)
  }

  function handleReplaceConflicts() {
    if (!pendingUpload) return
    const filesToUpload = pendingUpload.files
    setPendingUpload(null)
    void proceedUpload(filesToUpload)
  }

  function handleSkipConflicts() {
    if (!pendingUpload) return
    const conflictSet = new Set(pendingUpload.conflictNames)
    const nonConflicting = pendingUpload.files.filter((file) => !conflictSet.has(file.name))
    setPendingUpload(null)
    if (nonConflicting.length > 0) void proceedUpload(nonConflicting)
  }

  function handleCancelUpload() {
    setPendingUpload(null)
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files
    if (inputRef.current) inputRef.current.value = ''
    if (!fileList || fileList.length === 0) return
    await uploadFiles(fileList)
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounter.current += 1
    setIsDragging(true)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setIsDragging(false)
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    dragCounter.current = 0
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      await uploadFiles(e.dataTransfer.files)
    }
  }

  const header = (
    <div className="flex items-center justify-between gap-3">
      <FileManagerBreadcrumb prefix={selectedPrefix} onNavigate={setSelectedPrefix} />
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-border p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            title="List view"
            className={`flex size-7 items-center justify-center rounded-md transition-colors ${
              viewMode === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <List size={15} />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            title="Thumbnail view"
            className={`flex size-7 items-center justify-center rounded-md transition-colors ${
              viewMode === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutGrid size={15} />
          </button>
        </div>
        <ElementButton size="sm" onClick={() => inputRef.current?.click()}>
          <Upload size={15} />
          Upload File
        </ElementButton>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ALLOWED_FILE_ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={handleFileSelected}
      />
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <FileManagerSidebar selectedPrefix={selectedPrefix} onSelect={setSelectedPrefix} />
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <FileManagerUploadQueue items={uploadQueue} />
        {viewMode === 'list' ? (
          <ElementTable<FileManagerItem>
            columns={columns}
            data={files}
            loading={isLoading}
            loadingRows={5}
            headerContent={header}
            emptyContent={<p>No files found</p>}
            classNames={{ container: 'flex h-full min-h-0 flex-col' }}
            bulkActionContent={renderBulkActions}
          />
        ) : (
          <FileManagerFileGrid
            files={files}
            loading={isLoading}
            headerContent={header}
            emptyContent={<p>No files found</p>}
            onRename={handleRequestFileRename}
            onMove={handleRequestFileMove}
            onCopy={handleRequestFileCopy}
            onDelete={handleRequestFileDelete}
            bulkActionContent={renderBulkActions}
          />
        )}
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5">
            <p className="text-sm font-medium text-primary">Drop files to upload</p>
          </div>
        )}
      </div>

      <FileManagerUploadConflictModal
        isOpen={pendingUpload !== null}
        conflictNames={pendingUpload?.conflictNames ?? []}
        onReplace={handleReplaceConflicts}
        onSkip={handleSkipConflicts}
        onCancel={handleCancelUpload}
      />

      <ElementModal.Confirm
        isOpen={fileRenameTarget !== null}
        onClose={(open) => { if (!open) { setFileRenameTarget(null); setFileRenameValue('') } }}
        variant="default"
        title="Rename File"
        description={fileRenameTarget ? `Rename "${fileRenameTarget.name}".` : undefined}
        confirmText="Rename"
        isLoading={isFileRenaming}
        disabledConfirm={!fileRenameValue.trim()}
        onConfirm={handleConfirmFileRename}
      >
        <Input
          value={fileRenameValue}
          onChange={(e) => setFileRenameValue(e.target.value)}
          placeholder="File name"
          autoFocus
        />
      </ElementModal.Confirm>

      <FileManagerDirectoryPicker
        isOpen={fileTransferAction !== null}
        title={fileTransferAction?.type === 'move' ? 'Move File' : 'Copy File'}
        confirmText={fileTransferAction?.type === 'move' ? 'Move' : 'Copy'}
        isSubmitting={isFileTransferring}
        onClose={() => setFileTransferAction(null)}
        onConfirm={handleConfirmFileTransfer}
      />

      <ElementModal.Confirm
        isOpen={fileDeleteTarget !== null}
        onClose={(open) => { if (!open) setFileDeleteTarget(null) }}
        variant="danger"
        title="Delete File"
        description={fileDeleteTarget ? `Delete "${fileDeleteTarget.name}"? This cannot be undone.` : undefined}
        confirmText="Delete"
        isLoading={isFileDeleting}
        onConfirm={handleConfirmFileDelete}
      />

      <FileManagerDirectoryPicker
        isOpen={bulkTransferAction !== null}
        title={
          bulkTransferAction
            ? `${bulkTransferAction.type === 'move' ? 'Move' : 'Copy'} ${bulkTransferAction.files.length} Files`
            : ''
        }
        confirmText={bulkTransferAction?.type === 'move' ? 'Move' : 'Copy'}
        isSubmitting={isBulkTransferring}
        onClose={() => setBulkTransferAction(null)}
        onConfirm={handleConfirmBulkTransfer}
      />

      <ElementModal.Confirm
        isOpen={bulkDeleteAction !== null}
        onClose={(open) => { if (!open) setBulkDeleteAction(null) }}
        variant="danger"
        title="Delete Files"
        description={
          bulkDeleteAction
            ? `Delete ${bulkDeleteAction.files.length} file${bulkDeleteAction.files.length > 1 ? 's' : ''}? This cannot be undone.`
            : undefined
        }
        confirmText="Delete"
        isLoading={isBulkDeleting}
        onConfirm={handleConfirmBulkDelete}
      />
    </div>
  )
}
