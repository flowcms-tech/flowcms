'use client'

import { Lock, PenLine } from 'lucide-react'
import type { UsePostLock } from '../Functions/usePostLock'

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'moments ago'
  const minutes = Math.round(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
}

/**
 * The friendly half of post locking — the enforcement lives server-side in
 * the PATCH/DELETE routes. Two states worth showing: someone else has this
 * post open (editing is disabled), or you do (a quiet reassurance, not a
 * warning — this is the common case and shouldn't look alarming).
 */
export default function PostLockBanner({ lock }: { lock: UsePostLock }) {
  if (lock.status === 'checking') return null

  if (lock.status === 'mine') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <PenLine size={13} />
        <span>Locked to you while you have this open — other admins will see it&apos;s being edited.</span>
      </div>
    )
  }

  const name = lock.lockedBy?.name || 'another admin'
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning-light px-4 py-3"
    >
      <div className="flex items-center gap-2 text-warning">
        <Lock size={15} />
        <p className="text-sm font-medium">Being edited by {name}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        {lock.lockedAt && `Started ${relativeTime(lock.lockedAt)}. `}
        Editing is disabled here until they finish, or their session has been idle for a minute
        — this page checks automatically and unlocks itself the moment it&apos;s free.
      </p>
    </div>
  )
}
