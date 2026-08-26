'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Home, ChevronRight, Check } from 'lucide-react'
import ElementModal, { ElementModalFooter } from '@/components/shared/ElementModal/ElementModal'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import { getFileCategory, type FileCategory } from '@/Framework/Functions/FileValidation'
import { fetchFileSelectorDirectory, type FileSelectorItem } from './ElementFileSelector.api'
import ElementFileSelectorFileIcon from './ElementFileSelectorFileIcon'
import ElementFileSelectorTreeNode from './ElementFileSelectorTreeNode'

interface ElementFileSelectorModalProps {
  isOpen: boolean
  onClose: () => void
  multiple: boolean
  accept?: FileCategory | FileCategory[]
  onSelectSingle: (item: FileSelectorItem) => void
  onSelectMultiple: (items: FileSelectorItem[]) => void
}

function matchesAccept(fileName: string, accept?: FileCategory | FileCategory[]): boolean {
  if (!accept) return true
  const category = getFileCategory(fileName)
  const list = Array.isArray(accept) ? accept : [accept]
  return list.includes(category)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Breadcrumb({ prefix, onNavigate }: { prefix: string; onNavigate: (prefix: string) => void }) {
  const segments = prefix.split('/').filter(Boolean)

  return (
    <div className="flex items-center gap-1 text-sm">
      <button
        type="button"
        onClick={() => onNavigate('')}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Home"
      >
        <Home size={15} />
      </button>
      {segments.map((segment, index) => {
        const segmentPrefix = `${segments.slice(0, index + 1).join('/')}/`
        const isLast = index === segments.length - 1
        return (
          <div key={segmentPrefix} className="flex items-center gap-1">
            <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
            {isLast ? (
              <ElementBadge variant="info">{segment}</ElementBadge>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(segmentPrefix)}
                className="rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {segment}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function ElementFileSelectorModal({
  isOpen,
  onClose,
  multiple,
  accept,
  onSelectSingle,
  onSelectMultiple,
}: ElementFileSelectorModalProps) {
  const [prefix, setPrefix] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  // Reset the selection each time the modal transitions to open — adjusting
  // state during render (React's recommended alternative to a setState-in-
  // effect) instead of syncing via a useEffect.
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) setSelectedKeys(new Set())
  }

  const { data, isLoading } = useQuery({
    queryKey: ['element-file-selector-dir', prefix],
    queryFn: () => fetchFileSelectorDirectory(prefix),
    enabled: isOpen,
  })

  const files = (data?.files ?? []).filter((file) => matchesAccept(file.name, accept))

  function toggleSelected(item: FileSelectorItem) {
    if (!multiple) {
      onSelectSingle(item)
      return
    }
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(item.id)) {
        next.delete(item.id)
      } else {
        next.add(item.id)
      }
      return next
    })
  }

  function handleConfirmMultiple() {
    const selectedItems = files.filter((file) => selectedKeys.has(file.id))
    onSelectMultiple(selectedItems)
  }

  return (
    <ElementModal
      isOpen={isOpen}
      onClose={(open) => { if (!open) onClose() }}
      title="Select File"
      size="lg"
      footer={
        multiple ? (
          <ElementModalFooter>
            <ElementButton variant="cancel" onClick={onClose}>Cancel</ElementButton>
            <ElementButton onClick={handleConfirmMultiple} disabled={selectedKeys.size === 0}>
              Select {selectedKeys.size} File{selectedKeys.size === 1 ? '' : 's'}
            </ElementButton>
          </ElementModalFooter>
        ) : undefined
      }
    >
      <div className="flex h-[480px] flex-col gap-4">
        <Breadcrumb prefix={prefix} onNavigate={setPrefix} />

        <div className="flex min-h-0 flex-1 gap-4">
          <div className="w-56 shrink-0 overflow-y-auto styled-scrollbar border-e border-border pe-3">
            <ElementFileSelectorTreeNode
              prefix=""
              name="Home"
              depth={0}
              selectedPrefix={prefix}
              onSelect={setPrefix}
              defaultExpanded
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto styled-scrollbar">
            {isLoading ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className="aspect-square animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : files.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No files found
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {files.map((file) => {
                  const isSelected = selectedKeys.has(file.id)
                  return (
                    <button
                      type="button"
                      key={file.id}
                      onClick={() => toggleSelected(file)}
                      className={`group relative flex flex-col items-center gap-2 rounded-lg border p-3 text-center hover:bg-muted/50 ${
                        isSelected ? 'border-primary bg-primary/5' : 'border-transparent hover:border-border'
                      }`}
                    >
                      {multiple && (
                        <div
                          className={`absolute left-1 top-1 flex size-5 items-center justify-center rounded border ${
                            isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'
                          }`}
                        >
                          {isSelected && <Check size={12} />}
                        </div>
                      )}
                      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-muted">
                        {file.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={file.thumbnailUrl} alt={file.name} className="size-full object-cover" />
                        ) : (
                          <ElementFileSelectorFileIcon name={file.name} size={32} className="text-muted-foreground" />
                        )}
                      </div>
                      <span className="w-full truncate text-xs font-medium" title={file.name}>
                        {file.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{formatBytes(file.size)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </ElementModal>
  )
}
