#!/usr/bin/env node
/**
 * The `create-flowcms` executable.
 *
 * Deliberately thin: parse nothing, decide nothing, own only the process exit
 * code and the signal handlers. Everything testable lives in ../src, where it
 * can be called without spawning a process.
 */
import { main } from "../src/cli.mjs"

// A scaffold interrupted mid-copy leaves a directory this process created.
// Removing it is tempting and wrong: by the time SIGINT arrives we may be
// inside `npm install`, where the project is complete and worth keeping, and
// there is no safe way to tell from here. So the handlers do the one thing
// that is always correct — stop, say so plainly, and never claim success.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.error(`\nInterrupted (${signal}). Nothing further was written.`)
    process.exit(130)
  })
}

process.exitCode = await main(process.argv.slice(2))
