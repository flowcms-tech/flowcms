/**
 * Which bundler the containerised dev server runs, and why the answer depends
 * on the host.
 *
 * TURBOPACK'S WATCHER IS BLIND THROUGH A WINDOWS BIND MOUNT.
 *
 * Measured, not inferred. With the container's own `grep` showing the edited
 * text in `/app/src/…`, the dev server went on serving the previous markup —
 * in BOTH watcher modes:
 *
 *   event-driven   a Windows host's filesystem events do not cross the mount,
 *                  so the watcher is never told anything changed;
 *   polling        `watchOptions.pollIntervalMs` does reach Turbopack (Next
 *                  passes it into its `watch` options, and the poll watcher's
 *                  characteristic "watch error … NotFound" lines prove it is
 *                  running) — and edits are still not detected.
 *
 * Neither mode reports an error about the file that changed, which is what
 * makes the symptom so disorienting: every file on disk is correct, the
 * container agrees, and nothing rebuilds. Webpack's `WATCHPACK_POLLING`
 * watcher was then tested the same way and picks the edit up live.
 *
 * WHY THE DEFAULT IS PLATFORM-SPECIFIC AND NARROW
 *
 * win32 gets webpack because that is where the failure was reproduced and the
 * fix measured. Linux shares a kernel with the container and its inotify events
 * cross the mount natively, so it keeps Next's own default — switching it there
 * would degrade a working setup and silently change compilation semantics for
 * no reason. macOS also keeps the default: not because it is known to work, but
 * because it has NOT been tested here, and asserting otherwise is exactly the
 * unevidenced upgrade `docs/distribution/package-managers.md` exists to
 * prevent. A macOS developer seeing stale pages sets the variable.
 */

/** The value Next's own default implies — no flag, Turbopack. */
export const NEXT_DEFAULT_BUNDLER = ""

/**
 * @param platform   `process.platform` of the HOST, which is where this runs.
 * @param configured an explicit FLOWCMS_DEV_BUNDLER, if the developer set one.
 * @returns `{ bundler, reason }` — `bundler` is "" for Next's default.
 */
export function resolveBundler(platform, configured) {
  const explicit = (configured ?? "").trim().toLowerCase()

  // An explicit choice wins in BOTH directions. A developer who wants to
  // reproduce a Turbopack-specific bug on Windows sets it to `turbopack` and
  // gets Turbopack, stale watcher and all.
  if (explicit !== "") {
    return { bundler: explicit === "turbopack" ? NEXT_DEFAULT_BUNDLER : explicit, reason: "FLOWCMS_DEV_BUNDLER" }
  }

  if (platform === "win32") return { bundler: "webpack", reason: "windows host" }

  return { bundler: NEXT_DEFAULT_BUNDLER, reason: "next default (turbopack)" }
}
