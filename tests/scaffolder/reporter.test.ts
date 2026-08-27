import { describe, expect, it } from "vitest"
import { PassThrough } from "node:stream"
import { createReporter } from "../../packages/create-flowcms/src/prompts/reporter.mjs"

/**
 * THE INSTALLER'S NARRATION, which has two audiences that want opposite things.
 *
 * An operator watching a template copy wants a spinner. A CI job capturing
 * stdout wants three lines and no cursor movements — a spinner redrawing
 * several times a second turns a build log into a megabyte of escape codes.
 * So there are two narrators behind one interface, and the thing worth pinning
 * is that the PLAIN one did not change when Clack arrived: a scripted run's
 * output is what it always was.
 */

function recorder() {
  const out: string[] = []
  const err: string[] = []
  return {
    io: {
      log: (m: unknown = "") => void out.push(String(m)),
      error: (m: unknown = "") => void err.push(String(m)),
    },
    out: () => out.join("\n"),
    err: () => err.join("\n"),
  }
}

/** Anything that would make a build log unreadable. */
const ANSI = new RegExp("\\u001b\\[")

describe("the plain reporter, which CI and every scripted run get", () => {
  it("writes the lines the pre-Clack installer wrote", () => {
    const r = recorder()
    const reporter = createReporter({ interactive: false, io: r.io })

    reporter.heading("Creating a FlowCMS site in /tmp/my-site")
    reporter.step("Copying the application template")
    reporter.stepDone("Copied the application template")
    reporter.success(["Created my-site in /tmp/my-site", "", "Next steps:", "  cd my-site"])

    expect(r.out()).toContain("Creating a FlowCMS site in /tmp/my-site")
    // Two spaces: the indent the installer has always used for a step, and the
    // one `orchestration.test.ts` still matches on.
    expect(r.out()).toContain("  Copying the application template")
    expect(r.out()).toContain("Created my-site in /tmp/my-site")
    expect(r.out()).toContain("  cd my-site")
  })

  it("does not double every step by also announcing its completion", () => {
    // A plain log has nothing to close — the step line already said what
    // happened. Printing a second line per step would double the output of
    // every CI run for no information.
    const r = recorder()
    const reporter = createReporter({ interactive: false, io: r.io })
    reporter.step("Copying the application template")
    reporter.stepDone("Copied the application template")
    expect(r.out()).not.toContain("Copied the application template")
  })

  it("emits no ANSI escapes at all", () => {
    const r = recorder()
    const reporter = createReporter({ interactive: false, io: r.io })
    reporter.heading("h")
    reporter.summary("  Project  my-site")
    reporter.step("s")
    reporter.stepDone("d")
    reporter.releaseTerminal()
    reporter.resumeTerminal()
    reporter.success(["done"])
    reporter.failure(["bad"])
    expect(r.out()).not.toMatch(ANSI)
    expect(r.err()).not.toMatch(ANSI)
  })

  it("sends a failure to stderr, not stdout", () => {
    // A CI job branching on the stream, or a `2>` redirect, has to keep working.
    const r = recorder()
    const reporter = createReporter({ interactive: false, io: r.io })
    reporter.failure([
      "Dependency installation failed (npm install).",
      "  cd my-site && npm install",
    ])
    expect(r.err()).toContain("Dependency installation failed")
    expect(r.out()).not.toContain("Dependency installation failed")
  })

  it("writes the summary it is given, unchanged", () => {
    const r = recorder()
    const reporter = createReporter({ interactive: false, io: r.io })
    reporter.summary("  Project  my-site\n  Secrets  Generated")
    expect(r.out()).toContain("  Project  my-site")
    expect(r.out()).toContain("  Secrets  Generated")
  })
})

describe("the Clack reporter, which an operator at a terminal gets", () => {
  function terminal() {
    const output = new PassThrough()
    let seen = ""
    output.on("data", (c) => {
      seen += String(c)
    })
    return { output, seen: () => seen }
  }

  it("draws the finished step", () => {
    const t = terminal()
    const reporter = createReporter({ interactive: true, io: recorder().io, output: t.output })

    reporter.step("Copying the application template")
    reporter.stepDone("Copied the application template")

    // The COMPLETION is synchronous — `stop()` writes its final frame at once.
    // The start message is not: a spinner draws its first frame on a timer, so
    // a step that finishes immediately never shows one. That is the right
    // behaviour (no flicker for work that took no time) and it is why this
    // asserts on the frame that is guaranteed rather than the one that races.
    expect(t.seen()).toContain("Copied the application template")
  })

  it("draws the running step once the spinner has had a frame", async () => {
    const t = terminal()
    const reporter = createReporter({ interactive: true, io: recorder().io, output: t.output })

    reporter.step("Installing dependencies with npm")
    await new Promise((resolve) => setTimeout(resolve, 150))
    const running = t.seen()
    reporter.stepDone("Installed dependencies")

    expect(running).toContain("Installing dependencies with npm")
  })

  it("stops the running spinner before the terminal is handed to a child", () => {
    // The package manager is spawned with inherited stdio. A spinner still
    // drawing into the same rows produces interleaved garbage, and that is the
    // one thing this seam exists to prevent.
    const t = terminal()
    const reporter = createReporter({ interactive: true, io: recorder().io, output: t.output })

    reporter.step("Installing dependencies with npm")
    const before = t.seen().length
    reporter.releaseTerminal()
    const afterRelease = t.seen().length

    // Stopping writes its final frame; nothing further is drawn afterwards.
    expect(afterRelease).toBeGreaterThanOrEqual(before)
    const quiet = t.seen().length
    reporter.resumeTerminal()
    expect(t.seen().length).toBe(quiet)
  })

  it("survives stepDone with no step, and a doubled releaseTerminal", () => {
    const t = terminal()
    const reporter = createReporter({ interactive: true, io: recorder().io, output: t.output })
    expect(() => {
      reporter.stepDone("nothing was started")
      reporter.releaseTerminal()
      reporter.releaseTerminal()
      reporter.resumeTerminal()
    }).not.toThrow()
  })

  it("draws a failure on screen", () => {
    const t = terminal()
    const reporter = createReporter({ interactive: true, io: recorder().io, output: t.output })
    reporter.failure(["Dependency installation failed (npm install)."])
    expect(t.seen()).toContain("Dependency installation failed")
  })

  it("does not print a failure twice when stderr is the same terminal", () => {
    // Interactive means stdin AND stdout are TTYs, so stderr is almost always
    // the same screen. Writing there too would print the whole failure twice.
    const t = terminal()
    const r = recorder()
    const wasTTY = process.stderr.isTTY
    try {
      Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true })
      const reporter = createReporter({ interactive: true, io: r.io, output: t.output })
      reporter.failure(["Dependency installation failed (npm install)."])
      expect(r.err()).toBe("")
    } finally {
      Object.defineProperty(process.stderr, "isTTY", { value: wasTTY, configurable: true })
    }
  })

  it("still writes a failure to stderr when stderr is redirected to a file", () => {
    // `create-flowcms … 2>install-errors.log` — the reason an install failed is
    // exactly what somebody redirects stderr to keep.
    const t = terminal()
    const r = recorder()
    const wasTTY = process.stderr.isTTY
    try {
      Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true })
      const reporter = createReporter({ interactive: true, io: r.io, output: t.output })
      reporter.failure(["Dependency installation failed (npm install)."])
      expect(r.err()).toContain("Dependency installation failed")
    } finally {
      Object.defineProperty(process.stderr, "isTTY", { value: wasTTY, configurable: true })
    }
  })

  it("keeps the blank lines that group the closing report", () => {
    // Filtering every empty line out ran "Created…", the commands and the
    // first-owner instructions into one dense block. Clack renders a blank body
    // line as a bare │, which is the paragraph break the report was written
    // with.
    const t = terminal()
    const reporter = createReporter({ interactive: true, io: recorder().io, output: t.output })
    reporter.success([
      "",
      "Created my-site in /tmp/my-site",
      "",
      "Next steps:",
      "  cd my-site",
      "",
      "Then create the first owner:",
      "  1. Open http://localhost:3000/setup",
      "",
      ".env holds this project's real secrets.",
    ])

    const screen = t.seen().replace(new RegExp("\\u001b\\[[0-9;?]*[A-Za-z]", "g"), "")
    expect(screen).toContain("Created my-site in /tmp/my-site")
    expect(screen).toContain("Next steps:")
    expect(screen).toContain("Then create the first owner:")
    // The last line closes the interaction rather than sitting in the frame.
    expect(screen).toContain(".env holds this project's real secrets.")
    // A blank body line survives as a bare bar.
    expect(screen).toMatch(new RegExp("^│\\s*$", "m"))
  })
})
