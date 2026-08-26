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
   * The muting works by intercepting readline's own echo, which exists only
   * while the interface is in terminal mode. When stdout is redirected and a
   * terminal is still attached to stdin, the TTY driver echoes in the kernel
   * and nothing in this process can suppress it — so the prompt says so rather
   * than promising masking that is not happening.
   *
   * Driven here with an input that claims to be a TTY and an output that does
   * not, which is exactly `create-flowcms … | tee install.log`.
   */
  it("warns when the terminal is in a mode where input cannot be hidden", async () => {
    const input = new PassThrough() as PassThrough & { isTTY?: boolean }
    const output = new PassThrough()
    input.isTTY = true

    let transcript = ""
    let pending: NodeJS.Timeout | null = null
    const answers = ["2", "postgresql://user:pw@db.example.com:5432/flowcms"]

    output.on("data", (chunk) => {
      transcript += String(chunk)
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => {
        if (answers.length === 0) return
        input.write(answers.shift() + "\n")
      }, 10)
    })

    const session = await collectInteractively(
      {
        deploymentMode: "local",
        packageManager: "npm",
        storage: "garage",
        redis: "none",
        adminPath: "/admin",
      },
      { input, output },
    )
    session.close()

    // The database question is the masked one for a local deployment.
    expect(transcript).toMatch(/input can be hidden|cannot be hidden/i)
    // And the warning is never the credential itself.
    expect(transcript).not.toContain("postgresql://user:pw@db.example.com")
  })
})
