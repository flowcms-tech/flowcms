'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, ChevronDown, Folder, MoreVertical, Pencil, FolderInput, Copy, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { FileManagerServices } from '../Services/FileManagerServices'

interface FileManagerTreeNodeProps {
  prefix: string
  name: string
  depth: number
  selectedPrefix: string
  onSelect: (prefix: string) => void
  showActions?: boolean
  onRequestRename?: (prefix: string, currentName: string) => void
  onRequestMove?: (prefix: string, currentName: string) => void
  onRequestCopy?: (prefix: string, currentName: string) => void
  onRequestDelete?: (prefix: string) => void
  icon?: React.ReactNode
  defaultExpanded?: boolean
}

export default function FileManagerTreeNode({
  prefix,
  name,
  depth,
  selectedPrefix,
  onSelect,
  showActions = true,
  onRequestRename,
  onRequestMove,
  onRequestCopy,
  onRequestDelete,
  icon,
  defaultExpanded = false,
}: FileManagerTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const isSelected = selectedPrefix === prefix

  // Deliberately NOT gated on `isExpanded`. A folder cannot be known to be
  // empty until something lists it, and an expander that opens onto nothing is
  // a promise the row cannot keep — so every visible row buys that answer, at
  // the price of one listing per rendered node. It also makes expanding
  // instant, since the children are already cached by the time they are asked
  // for.
  const { data, isPending } = useQuery({
    queryKey: ['file-manager-dir', prefix],
    queryFn: () => FileManagerServices.listDirectory(prefix),
  })

  const childDirectories = data?.directories ?? []
  // Unknown counts as expandable: the control may then disappear for an empty
  // folder, but it never appears late on one that turned out to have children.
  const canExpand = isPending || childDirectories.length > 0
  const showRowActions = showActions && prefix !== ''

  return (
    <div>
      {/* The row carries its own bottom margin because the tree is recursive:
          only the row sits next to every other row, so a gap on any one
          container would miss the seams between depths. */}
      <div
        className={`group mb-0.5 flex items-center gap-1 rounded-md py-1.5 pe-1 text-sm cursor-pointer hover:bg-muted ${isSelected ? 'bg-muted font-medium' : ''}`}
        style={{ paddingInlineStart: `${depth * 16 + 8}px` }}
        onClick={() => { onSelect(prefix); setIsExpanded(true) }}
      >
        {canExpand ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded((prev) => !prev)
            }}
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          // Holds the column open so a childless folder's own icon and name
          // stay in line with its siblings' rather than sliding left.
          <span className="size-4 shrink-0" aria-hidden />
        )}
        {icon ?? <Folder size={14} className="shrink-0 text-muted-foreground" />}
        <span className="flex-1 truncate">{name}</span>
        {showRowActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="pointer-events-none flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:pointer-events-auto group-hover:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:bg-background data-[state=open]:opacity-100"
              >
                <MoreVertical size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => onRequestRename?.(prefix, name)}>
                <Pencil size={13} />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRequestMove?.(prefix, name)}>
                <FolderInput size={13} />
                Move
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRequestCopy?.(prefix, name)}>
                <Copy size={13} />
                Copy
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onRequestDelete?.(prefix)}>
                <Trash2 size={13} />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {isExpanded && childDirectories.map((childPrefix) => (
        <FileManagerTreeNode
          key={childPrefix}
          prefix={childPrefix}
          name={childPrefix.slice(prefix.length).replace(/\/$/, '')}
          depth={depth + 1}
          selectedPrefix={selectedPrefix}
          onSelect={onSelect}
          showActions={showActions}
          onRequestRename={onRequestRename}
          onRequestMove={onRequestMove}
          onRequestCopy={onRequestCopy}
          onRequestDelete={onRequestDelete}
        />
      ))}
    </div>
  )
}
