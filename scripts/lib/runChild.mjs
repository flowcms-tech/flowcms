import { spawn } from "node:child_process"
import { constants } from "node:os"

/**
 * Run a command to completion as a child of this process, inheriting stdio, and
 * resolve to the exit code a shell would report.
 *
 * Node has no `exec`: a launcher that spawns Next outlives it, so termination
 * has to be forwarded by hand. Without that, a platform's SIGTERM stops at the
 * launcher and the server is killed uncleanly when the grace period runs out.
 * `docker/entrypoint.sh` avoids the problem with `exec`; the launchers in
 * scripts/ use this.
 */

export const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"]

/** 128 + signal number for a signal death — SIGTERM is 143, the OOM killer's SIGKILL 137. */
export function exitCodeFor(code, signal) {
  if (signal) return 128 + (constants.signals[signal] ?? 0)
  return code ?? 1
}

export function runChild(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options })

    const forward = (signal) => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal)
    }
    for (const signal of FORWARDED_SIGNALS) process.on(signal, forward)
    const release = () => {
      for (const signal of FORWARDED_SIGNALS) process.off(signal, forward)
    }

    child.on("error", (error) => {
      release()
      reject(error)
    })
    child.on("exit", (code, signal) => {
      release()
      resolve(exitCodeFor(code, signal))
    })
  })
}
