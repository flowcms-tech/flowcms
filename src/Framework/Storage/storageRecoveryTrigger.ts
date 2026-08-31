/**
 * Making recovery happen without anybody asking for it.
 *
 * An interrupted cutover leaves a job in `cutting_over`, and that job IS the
 * storage write lock: every upload, rename and delete in the application is
 * refused while it stands. If the only thing that could resolve it were an
 * admin opening the storage settings page, a crash during a cutover would take
 * uploads down until a human happened to look — and the people best placed to
 * notice are the ones whose uploads have just stopped working.
 *
 * So the reconciliation is triggered from the paths that a running application
 * reaches on its own:
 *
 *   at startup                    once per process, before the first request
 *   when a write is refused       the exact moment a stale lock is doing harm
 *   when the state is read        so the admin screen never shows a stale answer
 *
 * FIRE AND FORGET, AND DEBOUNCED. It must never delay the thing that triggered
 * it: a write is already being refused for a reason that this may or may not
 * clear, and making the caller wait for a database round trip to find out would
 * turn a refusal into a slow refusal. The debounce stops a burst of blocked
 * uploads from starting a burst of reconciliations that all reach the same
 * conclusion.
 *
 * THE IMPORT IS DYNAMIC on purpose. This module is imported by
 * `storageWriteLock.ts`, which sits underneath `StorageService`; importing the
 * migration service statically would pull the drivers, the engine and the
 * settings service into that graph and make a cycle out of what is really a
 * one-way notification.
 */

/** The shortest gap between two reconciliation attempts, per process. */
const DEBOUNCE_MS = 10_000

let lastAttempt = 0
let inFlight = false

/**
 * Asks for a recovery pass, at most one at a time and at most one per window.
 *
 * Returns immediately and never throws: a failure here is a failure to REPAIR
 * something, not a failure of whatever called it, and the next trigger tries
 * again.
 */
export function triggerStorageRecovery(): void {
  const now = Date.now()
  if (inFlight || now - lastAttempt < DEBOUNCE_MS) return

  lastAttempt = now
  inFlight = true

  void (async () => {
    try {
      const { getMigrationService } = await import("./Migration/migrationRuntime")
      await getMigrationService().recover()
    } catch {
      // Nothing to do about it here. The database may be down — which is also
      // when the write lock fails closed — and the next trigger retries.
    } finally {
      inFlight = false
    }
  })()
}
