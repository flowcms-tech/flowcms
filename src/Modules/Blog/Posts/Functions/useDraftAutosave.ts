'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Autosaves an in-progress post to localStorage and offers to recover it.
 *
 * Deliberately local, not a server autosave. The failure this exists to stop
 * is a browser crash, an accidental refresh, or a closed tab mid-article —
 * all of which happen before any save, often on a *new* post that has no id
 * to autosave against yet. localStorage covers every one of those, survives
 * an offline moment, and costs no request per keystroke.
 *
 * The stored copy is cleared on a successful submit, so a recovery prompt
 * only ever appears for work that was genuinely never saved.
 */

const STORAGE_PREFIX = 'flowcms:post-draft:'
const SAVE_DEBOUNCE_MS = 2000

export interface StoredDraft<T> {
  values: T
  savedAt: number
}

function storageKey(postId: string | null): string {
  return `${STORAGE_PREFIX}${postId ?? 'new'}`
}

function readDraft<T>(postId: string | null): StoredDraft<T> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(postId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredDraft<T>
    return parsed && typeof parsed.savedAt === 'number' ? parsed : null
  } catch {
    // Corrupt or unavailable storage (private mode, quota) must never break
    // the editor — losing autosave is bad, blocking editing is worse.
    return null
  }
}

export interface UseDraftAutosaveOptions<T> {
  /** null while creating — the draft is then keyed as "new". */
  postId: string | null
  /** Current form values. Watched; written after SAVE_DEBOUNCE_MS of quiet. */
  values: T
  /** Skip saving until the form is genuinely populated/dirty. */
  enabled: boolean
}

export interface UseDraftAutosave<T> {
  /** A draft found on mount that was never submitted, if any. */
  recovered: StoredDraft<T> | null
  /** Last time this session wrote a draft. */
  savedAt: number | null
  /** Drop the recovery prompt without touching the stored copy. */
  dismissRecovered: () => void
  /** Discard the stored draft entirely. */
  clear: () => void
}

export function useDraftAutosave<T>({
  postId,
  values,
  enabled,
}: UseDraftAutosaveOptions<T>): UseDraftAutosave<T> {
  // Read once on mount, before any autosave of this session can overwrite it.
  const [recovered, setRecovered] = useState<StoredDraft<T> | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const hasCheckedRef = useRef(false)

  useEffect(() => {
    if (hasCheckedRef.current) return
    hasCheckedRef.current = true
    setRecovered(readDraft<T>(postId))
  }, [postId])

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey(postId))
    } catch {
      // Nothing useful to do — the draft simply stays until it's overwritten.
    }
    setRecovered(null)
    setSavedAt(null)
  }, [postId])

  const dismissRecovered = useCallback(() => setRecovered(null), [])

  const serialized = JSON.stringify(values)

  useEffect(() => {
    if (!enabled) return

    const timer = setTimeout(() => {
      try {
        const payload: StoredDraft<unknown> = { values: JSON.parse(serialized), savedAt: Date.now() }
        window.localStorage.setItem(storageKey(postId), JSON.stringify(payload))
        setSavedAt(payload.savedAt)
      } catch {
        // Quota exceeded or storage disabled. Silent by design: a warning
        // toast on every keystroke would be worse than the missing backup.
      }
    }, SAVE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [serialized, enabled, postId])

  return { recovered, savedAt, dismissRecovered, clear }
}
