'use client'

import { MoreVertical, Pencil, FolderInput, Copy, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

interface FileManagerFileActionsMenuProps {
  onRename: () => void
  onMove: () => void
  onCopy: () => void
  onDelete: () => void
  triggerClassName?: string
}

export default function FileManagerFileActionsMenu({
  onRename,
  onMove,
  onCopy,
  onDelete,
  triggerClassName,
}: FileManagerFileActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={
            triggerClassName ??
            'flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
          }
        >
          <MoreVertical size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={onRename}>
          <Pencil size={13} />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onMove}>
          <FolderInput size={13} />
          Move
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopy}>
          <Copy size={13} />
          Copy
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 size={13} />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
