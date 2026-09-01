'use client'

import { useState, type ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { mediaDownloadPath } from '@/Framework/Storage/mediaUrl'
import FileManagerFileIcon from './FileManagerFileIcon'
import FileManagerFileActionsMenu from './FileManagerFileActionsMenu'
import { formatBytes } from '../Values/FileManagerFormat'
import type { FileManagerItem } from '../Types'

interface FileManagerFileGridProps {
  files: FileManagerItem[]
  loading?: boolean
  loadingCount?: number
  emptyContent?: ReactNode
  headerContent?: ReactNode
  onProperties: (file: FileManagerItem) => void
  onRename: (file: FileManagerItem) => void
  onMove: (file: FileManagerItem) => void
  onCopy: (file: FileManagerItem) => void
  onDelete: (file: FileManagerItem) => void
  bulkActionContent?: (selected: FileManagerItem[], clearSelection: () => void) => ReactNode
}

export default function FileManagerFileGrid({
  files,
  loading = false,
  loadingCount = 12,
  emptyContent,
  headerContent,
  onProperties,
  onRename,
  onMove,
  onCopy,
  onDelete,
  bulkActionContent,
}: FileManagerFileGridProps) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  function toggleSelected(id: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function clearSelection() {
    setSelectedKeys(new Set())
  }

  const selectedFiles = files.filter((file) => selectedKeys.has(file.id))

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      {headerContent && (
        <div className="border-b border-border px-5 py-4">{headerContent}</div>
      )}

      {selectedFiles.length > 0 && bulkActionContent && (
        <div className="flex items-center gap-3 border-b border-border bg-primary/5 px-5 py-2.5">
          <span className="text-sm font-medium text-primary">{selectedFiles.length} selected</span>
          {bulkActionContent(selectedFiles, clearSelection)}
        </div>
      )}

      <div className="flex-1 overflow-y-auto styled-scrollbar">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: loadingCount }).map((_, index) => (
              <div key={index} className="aspect-square animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
            {emptyContent}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {files.map((file) => {
              const isSelected = selectedKeys.has(file.id)
              return (
                <div
                  key={file.id}
                  className={`group relative flex flex-col items-center gap-2 rounded-lg border p-3 text-center hover:bg-muted/50 ${
                    isSelected ? 'border-primary bg-primary/5' : 'border-transparent hover:border-border'
                  }`}
                >
                  <div
                    className={`absolute left-1 top-1 transition-opacity ${
                      isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelected(file.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-background"
                    />
                  </div>
                  <div className="absolute right-1 top-1 pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
                    <FileManagerFileActionsMenu
                      onProperties={() => onProperties(file)}
                      downloadHref={mediaDownloadPath(file.id)}
                      onRename={() => onRename(file)}
                      onMove={() => onMove(file)}
                      onCopy={() => onCopy(file)}
                      onDelete={() => onDelete(file)}
                      triggerClassName="flex size-6 items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm hover:bg-background hover:text-foreground"
                    />
                  </div>
                  <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-muted">
                    {file.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={file.thumbnailUrl} alt={file.name} className="size-full object-cover" />
                    ) : (
                      <FileManagerFileIcon name={file.name} size={32} className="text-muted-foreground" />
                    )}
                  </div>
                  <span className="w-full truncate text-xs font-medium" title={file.name}>
                    {file.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{formatBytes(file.size)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
