import { spinner, note, outro, log as clackLog } from "@clack/prompts"

/**
 * The installer's NARRATION, separated from its decisions.
 *
 * WHY THIS FILE EXISTS. A spinner is the right thing to show an operator
 * watching seven hundred files copy, and exactly the wrong thing to write into
 * a CI log: it emits cursor movements and redraws several times a second, so a
 * build that captures stdout ends up with a megabyte of escape codes where
 * three lines used to be. The installer therefore needs two narrators and one
 * caller — which is all this module is.
 *
 * THE PLAIN ONE IS THE DEFAULT, and it reproduces the pre-Clack output line for
 * line. `tests/scaffolder/reporter.test.ts` pins that, and
 * `tests/scaffolder/orchestration.test.ts` still matches on those exact
 * strings. A non-interactive run prints today what it printed before Clack
 * existed, which is the whole of the compatibility promise.
 *
 * WHICH ONE YOU GET is decided by whether a PROMPT SESSION was opened, not by
 * probing the terminal a second time. `resolveConfig` already made that
 * decision once, against `process.stdin.isTTY && process.stdout.isTTY`; asking
 * again here would be a second answer that could disagree with the first, and
 * the failure mode of disagreeing is a spinner in a log file.
 *
 * NOTHING HERE DECIDES ANYTHING. Every method takes finished text. The reporter
 * cannot leak a secret because it is never given one: `cli.mjs` builds the
 * summary from `SUMMARY_FIELDS` and the closing report from a whitelist of
 * lines, and both arrive here already safe.
 */

/**
 * @typedef {object} Reporter
 * @property {(text: string) => void}    heading         one line, before the work starts
 * @property {(text: string) => void}    summary         the pre-flight configuration block
 * @property {(message: string) => void} step            begins a unit of work
 * @property {(message: string) => void} stepDone        ends the unit `step` began
 * @property {() => void}                releaseTerminal stop drawing; a child is about to inherit stdio
 * @property {() => void}                resumeTerminal  the child has exited
 * @property {(lines: string[]) => void} success         the closing report
 * @property {(lines: string[]) => void} failure         the install-failed report
 */

/**
 * @param {{ interactive: boolean, io: { log: Function, error: Function }, output?: object }} options
 * @returns {Reporter}
 */
export function createReporter({ interactive, io, output }) {
  return interactive ? clackReporter(io, output ?? process.stdout) : plainReporter(io)
}

/** Drop leading and trailing blank lines, keeping every one in between. */
function trimBlankEnds(lines) {
  const out = [...lines]
  while (out.length > 0 && out[0].trim() === "") out.shift()
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop()
  return out
}

/**
 * What every non-interactive run prints. Unchanged from before Clack.
 */
function plainReporter(io) {
  return {
    heading: (text) => {
      io.log("")
      io.log(text)
    },
    summary: (text) => {
      io.log("")
      io.log(text)
    },
    // Two spaces, because that is the indent the installer has always used for
    // a step, and `orchestration.test.ts` matches the result.
    step: (message) => io.log(`  ${message}`),
    // A plain log has nothing to close: the step line already said what
    // happened, and a second line per step would double every CI run's output
    // for no information.
    stepDone: () => {},
    releaseTerminal: () => {},
    resumeTerminal: () => {},
    success: (lines) => {
      for (const line of lines) io.log(line)
    },
    failure: (lines) => {
      for (const line of lines) io.error(line)
    },
  }
}

/**
 * What an operator at a terminal sees.
 *
 * ONE SPINNER AT A TIME, held here rather than passed around, because the
 * package-manager step has to be able to stop whatever is spinning before the
 * child inherits the terminal. A spinner still drawing while npm writes to the
 * same rows produces interleaved garbage, and the operator cannot tell which
 * half is the error.
 */
function clackReporter(io, output) {
  let active = null

  const stop = (message) => {
    if (!active) return
    active.stop(message)
    active = null
  }

  return {
    heading: (text) => clackLog.step(text, { output }),
    // A framed block, because a summary is a thing to READ rather than a thing
    // that scrolls past. The rows arrive pre-aligned from `formatSummary`.
    summary: (text) => note(text, "Configuration", { output }),
    step: (message) => {
      // Defensive: a step that begins while another is running would otherwise
      // leave the first spinner drawing forever.
      stop()
      active = spinner({ output })
      active.start(message)
    },
    stepDone: (message) => stop(message),
    /**
     * Hand the terminal to a child process.
     *
     * The package manager is spawned with `stdio: "inherit"`, so from here
     * until it exits this process must not draw a single frame. Stopping rather
     * than pausing: a spinner resumed after a minute of npm output would redraw
     * over the install's last lines, which are the ones worth reading.
     */
    releaseTerminal: () => stop(),
    /**
     * The child has exited.
     *
     * Deliberately empty, and deliberately still called. The next thing that
     * happens is either `success` or `failure`, both of which open their own
     * frame; drawing anything here would only push the install's output up the
     * screen. It exists so the CALL SITE reads symmetrically — release, run,
     * resume — rather than leaving a reader to wonder where control came back.
     */
    resumeTerminal: () => {},
    /**
     * The closing report, in three parts.
     *
     *   headline   what was created — a ✓ line, because it is the answer to
     *              "did it work"
     *   body       the commands, FRAMED, because they are a thing to come back
     *              to rather than a thing that scrolls past
     *   closing    the outro, which ends the interaction
     *
     * INTERIOR BLANK LINES ARE KEPT. The first version of this filtered every
     * empty line out, which ran "Created…", the commands and the first-owner
     * instructions into one dense block with no grouping at all. Clack renders
     * a blank body line as a bare `│`, which is exactly the paragraph break the
     * report was written with.
     */
    success: (lines) => {
      const body = trimBlankEnds(lines)
      if (body.length === 0) return outro("", { output })
      if (body.length === 1) return outro(body[0], { output })

      const headline = body.shift()
      const closing = body.pop()
      const middle = trimBlankEnds(body)

      clackLog.success(headline, { output })
      // Untitled: the body already opens with "Next steps:", and a frame
      // titled the same thing would say it twice.
      if (middle.length > 0) note(middle.join("\n"), undefined, { output })
      outro(closing, { output })
    },
    failure: (lines) => {
      stop()
      for (const line of lines) {
        if (line.trim() === "") continue
        clackLog.error(line, { output })
      }
      // AND to the real stderr — but ONLY when stderr is not the same terminal
      // we just drew on.
      //
      // Interactive means stdin AND stdout are both TTYs, so writing to stderr
      // as well would normally print the whole failure twice on one screen.
      // The case worth keeping is `create-flowcms … 2>install-errors.log`,
      // where stderr is a file: the reason an install failed is exactly what
      // somebody redirects stderr to keep, and it would otherwise be captured
      // nowhere.
      if (!process.stderr?.isTTY) {
        for (const line of lines) io.error(line)
      }
    },
  }
}
