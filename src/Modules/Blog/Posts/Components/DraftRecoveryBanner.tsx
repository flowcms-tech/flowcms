'use client'

import { RotateCcw, X } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'

function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'less than a minute ago'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Offered when unsaved work is found on mount. Recovery is never automatic —
 * silently replacing what the admin sees with an older autosave would be its
 * own kind of data loss.
 */
export default function DraftRecoveryBanner({
  savedAt,
  onRecover,
  onDiscard,
}: {
  savedAt: number
  onRecover: () => void
  onDiscard: () => void
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3"
    >
      <div className="flex flex-col">
        <p className="text-sm font-medium">Unsaved changes found</p>
        <p className="text-xs text-muted-foreground">
          This post has edits from {relativeTime(savedAt)} that were never saved.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <ElementButton size="sm" variant="outline" onClick={onRecover}>
          <RotateCcw size={14} />
          Restore them
        </ElementButton>
        <ElementButton size="sm" variant="cancel" onClick={onDiscard}>
          <X size={14} />
          Discard
        </ElementButton>
      </div>
    </div>
  )
}
