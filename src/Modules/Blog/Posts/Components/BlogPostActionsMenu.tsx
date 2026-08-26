'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { MoreVertical, Eye, ArrowRightLeft, Copy, Pencil, Trash2, RotateCcw, Globe, EyeOff } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import type { BlogPost } from '../Types'
import type { TrashActions } from '../Values/BlogPostValues'

interface BlogPostActionsMenuProps {
  post: BlogPost
  onEdit: (row: BlogPost) => void
  onTogglePublished: (row: BlogPost) => void
  onDelete: (row: BlogPost) => void
  onRedirect: (row: BlogPost) => void
  onDuplicate: (row: BlogPost) => void
  trash?: TrashActions
}

export default function BlogPostActionsMenu({
  post,
  onEdit,
  onTogglePublished,
  onDelete,
  onRedirect,
  onDuplicate,
  trash,
}: BlogPostActionsMenuProps) {
  const adminHref = useAdminHref()
  const openPreview = () =>
    window.open(adminHref(`/blog/posts/${post.id}/preview`), '_blank', 'noopener')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Actions"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MoreVertical size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44 p-1.5">
        <DropdownMenuItem className="gap-2 px-2.5 py-2 text-sm" onSelect={openPreview}>
          <Eye size={15} />
          Preview
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 px-2.5 py-2 text-sm" onSelect={() => onRedirect(post)}>
          <ArrowRightLeft size={15} />
          Redirect
        </DropdownMenuItem>
        {trash?.isTrashView ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 px-2.5 py-2 text-sm" onSelect={() => trash.onRestore(post)}>
              <RotateCcw size={15} />
              Restore
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              className="gap-2 px-2.5 py-2 text-sm"
              onSelect={() => trash.onPurge(post)}
            >
              <Trash2 size={15} />
              Delete permanently
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem className="gap-2 px-2.5 py-2 text-sm" onSelect={() => onDuplicate(post)}>
              <Copy size={15} />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 px-2.5 py-2 text-sm" onSelect={() => onTogglePublished(post)}>
              {post.isPublished ? <EyeOff size={15} /> : <Globe size={15} />}
              {post.isPublished ? 'Unpublish' : 'Publish'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 px-2.5 py-2 text-sm" onSelect={() => onEdit(post)}>
              <Pencil size={15} />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              className="gap-2 px-2.5 py-2 text-sm"
              onSelect={() => onDelete(post)}
            >
              <Trash2 size={15} />
              Move to trash
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
