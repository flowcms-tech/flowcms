import BAPI from '@/Framework/API_Layer'

export type LockStatus = 'mine' | 'locked-by-other' | 'free'

export interface LockState {
  status: LockStatus
  lockedBy: { id: string; name: string } | null
  lockedAt: string | null
}

interface ApiResponse<T> { data: T; message: string | string[] }

export const PostLockServices = {
  async status(postId: string): Promise<LockState> {
    const res = await BAPI.get<ApiResponse<LockState>>(
      `/api/blog/posts/${postId}/lock`,
      { showGlobalError: false, showGlobalSuccess: false }
    )
    return res.data
  },

  /** Acquire or heartbeat-refresh. A 409 (locked by someone else) is a normal,
   *  expected outcome here — not an error toast — so this reads the response
   *  out of the rejected axios error itself rather than throwing past it. */
  async acquire(postId: string): Promise<LockState> {
    try {
      const res = await BAPI.post<ApiResponse<LockState>>(
        `/api/blog/posts/${postId}/lock`,
        {},
        { showGlobalError: false, showGlobalSuccess: false }
      )
      return res.data
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: ApiResponse<LockState> } }
      if (axiosErr.response?.status === 409 && axiosErr.response.data) {
        return axiosErr.response.data.data
      }
      throw err
    }
  },

  /** Best-effort release, fired on unmount/navigation. Bypasses BAPI/axios in
   *  favor of a keepalive fetch: axios has no reliable way to guarantee a
   *  request completes after the component that issued it has already
   *  unmounted, and `keepalive` is exactly the browser primitive built for
   *  "let this outlive the page." Failures are swallowed — the lock's own
   *  60s staleness timeout is the fallback if this never lands. */
  release(postId: string): void {
    void fetch(`/api/blog/posts/${postId}/lock`, {
      method: 'DELETE',
      credentials: 'include',
      keepalive: true,
    }).catch(() => undefined)
  },
}
