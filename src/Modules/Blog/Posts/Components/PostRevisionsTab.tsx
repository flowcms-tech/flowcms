'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { History } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import { BlogPostServices } from '../Services/BlogPostServices'
import type { BlogPostRevision } from '../Types'

function formatWhen(value: string): string {
  const date = new Date(value)
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function PostRevisionsTab({ postId }: { postId: string }) {
  const queryClient = useQueryClient()
  const [previewTarget, setPreviewTarget] = useState<BlogPostRevision | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<BlogPostRevision | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['blog-post-revisions', postId],
    queryFn: () => BlogPostServices.listRevisions(postId),
  })

  const revisions = data ?? []

  const handleRestore = async () => {
    if (!restoreTarget) return
    setIsRestoring(true)
    try {
      await BlogPostServices.restoreRevision(postId, restoreTarget.id)
      await queryClient.invalidateQueries({ queryKey: ['blog-post', postId] })
      await queryClient.invalidateQueries({ queryKey: ['blog-post-revisions', postId] })
    } catch {
      return
    } finally {
      setIsRestoring(false)
    }
    setRestoreTarget(null)
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading history…</p>
  }

  if (revisions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
        <History size={20} className="text-muted-foreground" />
        <p className="text-sm font-medium">No revisions yet</p>
        <p className="max-w-md text-xs text-muted-foreground">
          A snapshot is saved automatically each time you change the title, description, or
          content. The most recent 20 are kept.
        </p>
      </div>
    )
  }

  return (
    <>
      <p className="text-xs text-muted-foreground">
        Each entry is how the post looked <em>before</em> that edit. Restoring one snapshots the
        current version first, so a restore is itself undoable.
      </p>

      <ul className="flex flex-col gap-2">
        {revisions.map((revision, index) => (
          <li
            key={revision.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {formatWhen(revision.createdAt)}
                {index === 0 && (
                  <span className="ms-2 text-xs font-normal text-muted-foreground">
                    most recent
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {revision.editor.name || 'Unknown editor'} · {revision.title}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <ElementButton size="sm" variant="outline" onClick={() => setPreviewTarget(revision)}>
                View
              </ElementButton>
              <ElementButton size="sm" onClick={() => setRestoreTarget(revision)}>
                Restore
              </ElementButton>
            </div>
          </li>
        ))}
      </ul>

      <ElementModal
        isOpen={previewTarget !== null}
        onClose={() => setPreviewTarget(null)}
        title={previewTarget ? `Revision from ${formatWhen(previewTarget.createdAt)}` : ''}
        size="lg"
      >
        {previewTarget && (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Title</p>
              <p className="text-sm">{previewTarget.title}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Description</p>
              <p className="text-sm">{previewTarget.excerpt}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Content</p>
              {/* Sanitized on write, so this is the same trusted HTML the
                  public page renders. */}
              <div
                className="prose prose-sm prose-neutral max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: previewTarget.content }}
              />
            </div>
          </div>
        )}
      </ElementModal>

      <ElementModal.Confirm
        isOpen={restoreTarget !== null}
        onClose={(v) => { if (!v) setRestoreTarget(null) }}
        variant="default"
        title="Restore this revision"
        description={
          restoreTarget
            ? `Replace the current title, description, and content with the version from ${formatWhen(restoreTarget.createdAt)}? The current version is saved to history first, so you can undo this.`
            : undefined
        }
        confirmText="Restore"
        cancelText="Cancel"
        isLoading={isRestoring}
        onConfirm={handleRestore}
      />
    </>
  )
}
