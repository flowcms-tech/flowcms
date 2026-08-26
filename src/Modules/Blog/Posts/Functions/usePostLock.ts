'use client'

import { useEffect, useRef, useState } from 'react'
import { PostLockServices, type LockState } from '../Services/PostLockServices'

/**
 * Post-locking for the edit page — the WordPress-style "someone else is
 * editing this" guard.
 *
 * Acquires on mount, heartbeats every 20s to keep the lock alive while the
 * tab stays open, and releases on unmount. While locked out by someone
 * else, polls every 15s and automatically re-attempts acquisition — so if
 * they close their tab, this page recovers into an editable state on its
 * own instead of leaving the admin stuck behind a stale banner.
 *
 * Server-side (the PATCH/DELETE routes) is where this is actually
 * *enforced* — an admin who never opened this hook, or whose browser has
 * JS disabled, still cannot overwrite a locked post. This hook is the
 * friendly warning in front of that, not a substitute for it.
 */

const HEARTBEAT_MS = 20_000
const POLL_WHEN_LOCKED_MS = 15_000

export interface UsePostLock {
  status: 'checking' | 'mine' | 'locked-by-other'
  lockedBy: { id: string; name: string } | null
  lockedAt: string | null
}

export function usePostLock(postId: string | null): UsePostLock {
  const [state, setState] = useState<UsePostLock>({ status: 'checking', lockedBy: null, lockedAt: null })
  const holdsLockRef = useRef(false)

  useEffect(() => {
    if (!postId) return
    // Re-bound to a local const: TypeScript can't carry the narrowing from
    // the guard above into the nested closures below, since `postId` is a
    // parameter that could in principle be reassigned by the time they run.
    const lockedPostId = postId

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    function applyResult(result: LockState) {
      if (cancelled) return
      holdsLockRef.current = result.status === 'mine'
      setState({ status: result.status === 'free' ? 'mine' : result.status, lockedBy: result.lockedBy, lockedAt: result.lockedAt })
    }

    async function tick() {
      try {
        const result = await PostLockServices.acquire(lockedPostId)
        applyResult(result)
      } catch {
        // A network hiccup shouldn't flip an editing admin into "locked out"
        // — leave the current state as-is and try again next tick.
      }
      if (cancelled) return
      timer = setTimeout(tick, holdsLockRef.current ? HEARTBEAT_MS : POLL_WHEN_LOCKED_MS)
    }

    tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (holdsLockRef.current) PostLockServices.release(lockedPostId)
    }
  }, [postId])

  return state
}
