'use client'

import { MoreVertical, Pencil, FolderInput, Copy, Download, Info, Repeat, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

interface FileManagerFileActionsMenuProps {
  onProperties: () => void
  /** The media route's `download=1` URL — a real link, so the file can be saved
   *  with a middle click or the browser's own context menu like any other. */
  downloadHref: string
  /** Omitted for anything that is not an image — there is nothing to convert. */
  onConvert?: () => void
  onRename: () => void
  onMove: () => void
  onCopy: () => void
  onDelete: () => void
  triggerClassName?: string
}

export default function FileManagerFileActionsMenu({
  onProperties,
  downloadHref,
  onConvert,
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
        {/* Grouped by what they do to the file: read, then change, then destroy. */}
        <DropdownMenuItem onSelect={onProperties}>
          <Info size={13} />
          Properties
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          {/* `download` also keeps the app-wide progress bar out of it: the
              provider reads a plain anchor click as a route change. */}
          <a href={downloadHref} download>
            <Download size={13} />
            Download
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {onConvert && (
          // Grouped with the actions that change the file even though it only
          // ever adds one: it is the same kind of intent, and it is where
          // someone looks for it.
          <DropdownMenuItem onSelect={onConvert}>
            <Repeat size={13} />
            Convert
          </DropdownMenuItem>
        )}
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
