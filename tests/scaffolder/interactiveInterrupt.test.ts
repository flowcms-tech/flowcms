import { afterEach, describe, expect, it } from "vitest"
import { PassThrough } from "node:stream"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  PromptInterrupted,
  collectInteractively,
} from "../../packages/create-flowcms/src/prompts/interactive.mjs"
import { main } from "../../packages/create-flowcms/src/cli.mjs"

/**
 * INTERRUPTING THE INSTALLER, which readline does not let the process see.
 *
 * A `readline.Interface` in terminal mode intercepts Ctrl+C itself. With no
 * `SIGINT` listener attached it closes the interface and says nothing: the
 * handler in `bin/create-flowcms.mjs` never runs, the promise the pending
 * question is waiting on is never settled, and the CLI exits **0 having written
 * nothing**. An installer that reports success for an interrupted run is worse
 * than one that hangs, because the script downstream of it believes the zero.
 *
 * WHAT THESE TESTS CAN AND CANNOT REACH. A `PassThrough` is not a terminal, so
 * they cannot deliver a real Ctrl+C; what they can do is close the input while
 * a question is pending, which is the same event readline turns Ctrl+C into and
 * the same path the fix has to survive. Real raw-mode behaviour — echo
 * suppression and the SIGINT keystroke itself — needs a pty and is documented as
 * a manual procedure in `docs/distribution/package-managers.md` instead.
 */

const temporary: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cf-int-"))
  temporary.push(dir)
  return dir
}
afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop()!, { recursive: true, force: true })
})

/**
 * A terminal that goes away while the first question is on screen.
 *
 * Driven by the output, like `interactivePrompts.test.ts`: when the prompt
 * stops writing, the question is finished being written and the operator's
 * terminal is closed instead of answered.
 */
function abandonedSession() {
  const input = new PassThrough()
  const output = new PassThrough()
  let pending: NodeJS.Timeout | null = null
  let closed = false

  output.on("data", () => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => {
      if (closed) return
      closed = true
      input.end()
    }, 10)
  })

  return { input, output }
}

describe("a question whose terminal closes", () => {
  it("rejects rather than waiting forever", async () => {
    await expect(collectInteractively({}, abandonedSession())).rejects.toBeInstanceOf(
      PromptInterrupted,
    )
  })

  it("carries a message that names no configuration", async () => {
    // The operator interrupted; there is nothing to report but the fact of it.
    await expect(collectInteractively({}, abandonedSession())).rejects.toThrow(
      /Nothing was written/,
    )
  })
})

describe("what the CLI does with an interruption", () => {
  it("exits 130 and writes nothing", async () => {
    const parent = tempDir()
    const target = join(parent, "my-site")
    const errors: string[] = []
    const io = {
      log: () => {},
      error: (message: unknown = "") => {
        errors.push(String(message))
      },
    }

    const code = await main([target], io, {
      // Interactive, so the resolver asks — and the asking is interrupted.
      isInteractive: () => true,
      prompt: () => {
        throw new PromptInterrupted()
      },
      isAvailable: async () => true,
    })

    // 130 is the documented exit code for an interrupt, and it is the same one
    // the signal handler in the bin uses. The operator did the same thing; the
    // two paths must not disagree about what happened.
    expect(code).toBe(130)
    expect(errors.join("\n")).toMatch(/Interrupted/)
  })

  it("does not report an interruption as a usage error", async () => {
    // 2 means "retype the command". An interrupt is not that, and a CI job
    // branching on the exit code has to be able to tell them apart.
    const parent = tempDir()
    const io = { log: () => {}, error: () => {} }

    const code = await main([join(parent, "my-site")], io, {
      isInteractive: () => true,
      prompt: () => {
        throw new PromptInterrupted()
      },
      isAvailable: async () => true,
    })

    expect(code).not.toBe(2)
    expect(code).not.toBe(0)
  })
})

describe("masking, and what it can honestly claim", () => {
  /**
   * WHY THE WARNING THIS BLOCK USED TO TEST IS GONE.
   *
   * The readline installer masked by intercepting its OWN echo, which exists
   * only while the interface is in terminal mode. Redirect stdout while a
   * terminal is still attached to stdin — `create-flowcms … | tee install.log`
   * — and the TTY driver echoes in the kernel instead, where nothing in this
   * process can stop it. The prompt could not detect that, so it printed a
   * warning rather than promising masking that was not happening.
   *
   * Clack does not have that failure mode. It renders the mask itself: the
   * characters are never echoed by anyone, they are drawn as bullets by the
   * prompt. There is no terminal state in which it silently stops masking, so
   * there is nothing left to warn about, and a warning that no longer describes
   * anything would be worse than none.
   *
   * What survives is the property the warning existed to protect, asserted
   * directly against the same redirected-output shape.
   */
  it("keeps a typed database URL out of the output stream", async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY?: boolean
      setRawMode?: (mode: boolean) => void
    }
    const output = new PassThrough()
    // A terminal on stdin, a pipe on stdout — the exact case the old warning
    // was about. Claiming `isTTY` obliges the fake to carry `setRawMode` too:
    // Clack switches a real terminal into raw mode to read single keys, and a
    // stream that says it is a terminal without offering that is a shape no
    // actual stdin has.
    input.isTTY = true
    input.setRawMode = () => {}

    let transcript = ""
    const keys = ["postgresql://user:pw@db.example.com:5432/flowcms\r"]

    output.on("data", (chunk) => {
      transcript += String(chunk)
    })

    const feeder = setInterval(() => {
      if (keys.length === 0) return
      if (input.readableLength > 0) return
      input.write(keys.shift()!)
    }, 20)

    const session = await collectInteractively(
      {
        deploymentMode: "local",
        packageManager: "npm",
        database: "postgresql",
        storage: "garage",
        redis: "none",
        adminPath: "/admin",
      },
      { input, output },
    )
    session.close()
    clearInterval(feeder)

    expect(transcript).not.toContain("postgresql://user:pw@db.example.com")
    expect(transcript).not.toContain("pw@db")
    // The field is still named, so the operator knows what is being asked for.
    expect(transcript).toContain("Connection URL")
  })
})
