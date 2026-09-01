'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, FolderInput, LayoutGrid, List, Trash2, Upload } from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementToast from '@/components/shared/ElementToast/ElementToast'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import {
  isAllowedFileType,
  getFileCategory,
  ALLOWED_FILE_ACCEPT_ATTRIBUTE,
  type FileCategory,
} from '@/Framework/Functions/FileValidation'
import { FileManagerServices } from './Services/FileManagerServices'
import { buildColumns } from './Values/FileManagerValues'
import FileManagerNameModal from './Components/FileManagerNameModal'
import FileManagerFilePropertiesModal from './Components/FileManagerFilePropertiesModal'
import FileManagerConvertModal, { type ConvertFormat } from './Components/FileManagerConvertModal'
import FileManagerSidebar from './Components/FileManagerSidebar'
import FileManagerBreadcrumb from './Components/FileManagerBreadcrumb'
import FileManagerUploadQueue, { type UploadQueueItem } from './Components/FileManagerUploadQueue'
import FileManagerUploadConflictModal from './Components/FileManagerUploadConflictModal'
import FileManagerDirectoryPicker from './Components/FileManagerDirectoryPicker'
import FileManagerFileGrid from './Components/FileManagerFileGrid'
import type { FileManagerItem } from './Types'

type ViewMode = 'list' | 'grid'

/**
 * Turns the browser into a picker as well as a manager.
 *
 * This is the ONLY difference between the admin page and the dialog an editor
 * opens from a form field. Both render this same component; the page passes
 * nothing, the dialog passes this. Any feature added below therefore appears in
 * both by construction — there is no second implementation to keep in step.
 */
export interface FileManagerSelection {
  mode: 'single' | 'multiple'
  /**
   * Categories that may be RETURNED. It never hides anything: a folder shows
   * the same contents in both shells, and a file you cannot choose can still be
   * renamed, moved or deleted.
   */
  accept?: FileCategory | FileCategory[]
  /** Storage keys (`FileManagerItem.id`), never URLs. */
  onConfirm: (keys: string[]) => void
}

export interface FileManagerBrowserProps {
  /** Absent → management only. Present → management *and* picking. */
  selection?: FileManagerSelection
}

function matchesAccept(fileName: string, accept?: FileCategory | FileCategory[]): boolean {
  if (!accept) return true
  const list = Array.isArray(accept) ? accept : [accept]
  return list.includes(getFileCategory(fileName))
}

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

/**
 * Splits a file name into the part that may be renamed and the extension that
 * may not: `["Rufus.4.13.2316.Portable", ".zip"]`.
 *
 * A leading dot is a whole name, not an extension, and a trailing dot is not one
 * either — both cases hand back the name with an empty extension, which leaves
 * the field fully editable rather than locking a suffix that means nothing.
 */
function splitFileName(name: string): [stem: string, extension: string] {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return [name, '']
  return [name.slice(0, dot), name.slice(dot)]
}

export default function FileManagerBrowser({ selection }: FileManagerBrowserProps = {}) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)
  const removalTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [selectedPrefix, setSelectedPrefix] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([])
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null)
  const [filePropertiesTarget, setFilePropertiesTarget] = useState<FileManagerItem | null>(null)
  const [fileConvertTarget, setFileConvertTarget] = useState<FileManagerItem | null>(null)
  const [isFileConverting, setIsFileConverting] = useState(false)
  const [fileRenameTarget, setFileRenameTarget] = useState<FileManagerItem | null>(null)
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

  const [renameStem, renameExtension] = fileRenameTarget
    ? splitFileName(fileRenameTarget.name)
    : ['', '']

  function handleRequestFileProperties(file: FileManagerItem) {
    setFilePropertiesTarget(file)
  }

  function handleRequestFileConvert(file: FileManagerItem) {
    setFileConvertTarget(file)
  }

  async function handleConfirmFileConvert(input: {
    format: ConvertFormat
    name: string
    destination: string
  }) {
    if (!fileConvertTarget) return
    setIsFileConverting(true)
    try {
      await FileManagerServices.convertFile({ key: fileConvertTarget.id, ...input })
      // Both folders, because the result can land somewhere other than the one
      // being looked at.
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', selectedPrefix] })
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', input.destination] })
      setFileConvertTarget(null)
    } catch {
      // Global error toast (via the axios interceptor) already surfaced this —
      // and the route's refusals (name taken, would overwrite the source) come
      // back through it as readable messages.
    } finally {
      setIsFileConverting(false)
    }
  }

  function handleRequestFileRename(file: FileManagerItem) {
    setFileRenameTarget(file)
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

  const columns = buildColumns(
    handleRequestFileProperties,
    handleRequestFileConvert,
    handleRequestFileRename,
    handleRequestFileMove,
    handleRequestFileCopy,
    handleRequestFileDelete,
  )

  async function handleConfirmFileRename(name: string) {
    if (!fileRenameTarget) return
    setIsFileRenaming(true)
    try {
      await FileManagerServices.renameFile(fileRenameTarget.id, name)
      await queryClient.invalidateQueries({ queryKey: ['file-manager-dir', selectedPrefix] })
      setFileRenameTarget(null)
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

  const canPick = (file: FileManagerItem) =>
    selection !== undefined && matchesAccept(file.name, selection.accept)

  function handlePickSingle(file: FileManagerItem) {
    if (selection?.mode !== 'single' || !canPick(file)) return
    selection.onConfirm([file.id])
  }

  function renderBulkActions(selected: FileManagerItem[], clearSelection: () => void) {
    // The confirm for a multi-pick lives HERE rather than in the hosting
    // dialog's footer, so the row-selection set never has to be lifted out of
    // the table that owns it. One set of checkboxes, both outcomes in view.
    const pickable = selected.filter(canPick)

    return (
      <div className="flex items-center gap-2">
        {selection?.mode === 'multiple' && (
          <ElementButton
            size="sm"
            disabled={pickable.length === 0}
            onClick={() => selection.onConfirm(pickable.map((file) => file.id))}
          >
            <Check size={14} />
            Use {pickable.length} selected
          </ElementButton>
        )}
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

  async function uploadFiles(fileList: FileList | File[]) {
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
    // `input.files` is a live FileList: resetting `value` empties it, so the
    // selection must be copied out before the reset that allows re-picking the
    // same file.
    const selectedFiles = Array.from(e.target.files ?? [])
    if (inputRef.current) inputRef.current.value = ''
    if (selectedFiles.length === 0) return
    await uploadFiles(selectedFiles)
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
        {/* h-8 to match the Upload button beside it. `p-px` is what makes the
            arithmetic exact: 32px, less 1px of border and 1px of padding on
            each edge, leaves precisely the 28px the two toggles occupy. */}
        <div className="flex h-8 items-center rounded-lg border border-border p-px">
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
        {/* `sm` for its smaller label, raised to the 32px the view toggle beside
            it stands at. `cn` is tailwind-merge, so this h-8 beats the variant's
            h-7 rather than fighting it. */}
        <ElementButton size="sm" className="h-8" onClick={() => inputRef.current?.click()}>
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
            onRowClick={selection?.mode === 'single' ? handlePickSingle : undefined}
            rowClassName={(file) => (selection && !canPick(file) ? 'opacity-40' : undefined)}
          />
        ) : (
          <FileManagerFileGrid
            files={files}
            loading={isLoading}
            headerContent={header}
            emptyContent={<p>No files found</p>}
            onProperties={handleRequestFileProperties}
            onConvert={handleRequestFileConvert}
            onRename={handleRequestFileRename}
            onMove={handleRequestFileMove}
            onCopy={handleRequestFileCopy}
            onDelete={handleRequestFileDelete}
            bulkActionContent={renderBulkActions}
            onFileClick={selection?.mode === 'single' ? handlePickSingle : undefined}
            isFileDimmed={(file) => selection !== undefined && !canPick(file)}
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

      {filePropertiesTarget && (
        <FileManagerFilePropertiesModal
          file={filePropertiesTarget}
          onClose={() => setFilePropertiesTarget(null)}
        />
      )}

      {fileConvertTarget && (
        <FileManagerConvertModal
          file={fileConvertTarget}
          isSubmitting={isFileConverting}
          onSubmit={handleConfirmFileConvert}
          onClose={() => setFileConvertTarget(null)}
        />
      )}

      {fileRenameTarget && (
        <FileManagerNameModal
          title="Rename File"
          description={`Rename "${fileRenameTarget.name}".`}
          label="File name"
          placeholder="File name"
          defaultValue={renameStem}
          suffix={renameExtension}
          confirmText="Rename"
          isSubmitting={isFileRenaming}
          onSubmit={handleConfirmFileRename}
          onClose={() => setFileRenameTarget(null)}
        />
      )}

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
