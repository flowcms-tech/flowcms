import { afterEach, describe, expect, it } from "vitest"
import { PassThrough } from "node:stream"
import {
  PromptInterrupted,
  collectInteractively,
  confirmAndClose,
} from "../../packages/create-flowcms/src/prompts/interactive.mjs"

/**
 * THE PROMPTS THEMSELVES, driven rather than stubbed.
 *
 * Everything else that touches the interactive path replaces
 * `collectInteractively` with a function returning fixed answers — which is the
 * right way to test the RESOLVER, and leaves the thing being replaced with no
 * coverage at all. The questions, the validation loops, the defaults, the
 * ordering and the cancellation are where an operator's keystrokes become
 * configuration, and this file is the only one that executes them.
 *
 * WHAT CHANGED WITH CLACK. The old UI read LINES: "2\n" chose the second
 * option. The new one reads KEYS, so the fixtures below send the bytes a
 * terminal actually sends — `\x1B[B` for Down, `\r` for Enter, `\x03` for
 * Ctrl+C. `@clack/prompts` takes `input`/`output` as options, so the same
 * injected-stream seam the readline version used still works, unchanged.
 *
 * WHAT THIS IS NOT. It is not a terminal. A `PassThrough` has no `isTTY`, so
 * Clack never enters raw mode; the keypresses arrive because
 * `readline.emitKeypressEvents` parses those same escape sequences. Glyph
 * rendering, cursor hiding and raw-mode echo are properties of the terminal
 * rather than of this code, and are verified by hand on Windows instead.
 */

/** The bytes a terminal actually sends. */
const DOWN = "\x1B[B"
const UP = "\x1B[A"
const RIGHT = "\x1B[C"
const ENTER = "\r"
const CTRL_C = "\x03"
const BACKSPACE = "\x7F"

/** Choose the nth option (0-based) of a select whose cursor starts at the top. */
const nth = (index: number) => DOWN.repeat(index) + ENTER

/**
 * A scripted operator: one keystroke batch per prompt, in order.
 *
 * DRIVEN BY THE INPUT BUFFER DRAINING, not by the output going quiet, and the
 * difference is the whole reason this helper is worth a comment.
 *
 * The obvious driver — "when the prompt stops drawing, type the next key" — is
 * what the readline version used, and it desynchronises against Clack. Between
 * one prompt submitting and the next one attaching its listener there is a
 * window in which nothing is reading. A key written into that window sits in
 * the stream's buffer; the output goes quiet again; the driver decides another
 * key is due; and the next prompt attaches and reads BOTH. One question eats
 * two answers, every later answer is off by one, and the run ends waiting for a
 * question that was already answered. That is exactly how the first version of
 * this file failed — twelve tests, ten of them timeouts.
 *
 * `input.readableLength` is the honest signal: it is non-zero precisely while a
 * written key has not been consumed. Feeding only when it is zero means the
 * operator types when — and only when — a prompt is actually listening.
 */
const running: Array<() => void> = []

function session(keys: string[], beforeAnswer?: (transcript: string, output: PassThrough) => void) {
  const input = new PassThrough()
  const output = new PassThrough()
  const queue = [...keys]

  let transcript = ""
  output.on("data", (chunk) => {
    transcript += String(chunk)
  })

  const timer = setInterval(() => {
    if (queue.length === 0) {
      clearInterval(timer)
      return
    }
    // The previous keystroke has not been read yet: no prompt is listening.
    if (input.readableLength > 0) return
    beforeAnswer?.(transcript, output)
    input.write(queue.shift()!)
  }, 20)

  running.push(() => clearInterval(timer))
  return { input, output, transcript: () => transcript }
}

// A cancelled run leaves keys nobody will ever read. Stopping every feeder
// keeps an abandoned interval from outliving the test that made it.
afterEach(() => {
  while (running.length > 0) running.pop()!()
})

/** The transcript with every ANSI escape removed — what a person would read. */
const visible = (raw: string) => raw.replace(new RegExp("\\u001b\\[[0-9;?]*[A-Za-z]", "g"), "")

/** Every prompt of a default Docker run answered by pressing enter. */
const allDefaults = () => [ENTER, ENTER, ENTER, ENTER, ENTER, ENTER]

describe("the questions an operator actually answers", () => {
  it("collects a full Docker configuration with the arrow keys", async () => {
    const io = session([
      nth(0), // How will this site run?     → docker
      nth(1), // Which package manager?      → pnpm
      nth(1), // Which database?             → postgresql
      nth(0), // Where do uploaded files go? → garage
      nth(1), // Redis?                      → bundled
      "/control" + ENTER,
    ])

    const { answers, close } = await collectInteractively({}, io)
    close()

    expect(answers).toMatchObject({
      deploymentMode: "docker",
      packageManager: "pnpm",
      database: "postgresql",
      storage: "garage",
      redis: "bundled",
      adminPath: "/control",
    })
  })

  it("takes the highlighted default when the operator just presses enter", async () => {
    const io = session(allDefaults())

    const { answers, close } = await collectInteractively({}, io)
    close()

    expect(answers).toMatchObject({
      deploymentMode: "docker",
      packageManager: "npm",
      database: "sqlite",
      storage: "garage",
      redis: "none",
      adminPath: "/admin",
    })
  })

  it("lets the operator move back up the list", async () => {
    // Down twice, up once, enter → the SECOND option, not the third. A list
    // that only moved one way would still pass every test above.
    //
    // Landing on "local" commits the fixture to the local branch: no storage
    // question, and the S3 block instead — two of whose fields are required and
    // will not accept a bare enter.
    const io = session([
      DOWN + DOWN + UP + ENTER, // local
      ENTER, // npm
      ENTER, // sqlite
      ENTER, // endpoint default
      ENTER, // region default
      ENTER, // bucket default
      "AKIA" + ENTER,
      "secret" + ENTER,
      ENTER, // no redis
      ENTER, // /admin
    ])
    const { answers, close } = await collectInteractively({}, io)
    close()
    expect(answers.deploymentMode).toBe("local")
  })

  it("presents no numbered choices at all", async () => {
    const io = session(allDefaults())
    const { close } = await collectInteractively({}, io)
    close()

    // The old UI listed "1) Docker Compose", prompted with "[1]", and scolded
    // with "Choose 1-2." None of the three may come back: this is the
    // regression the whole refactor exists to prevent.
    const screen = visible(io.transcript())
    expect(screen).not.toMatch(new RegExp("^\\s*\\d\\)\\s", "m"))
    expect(screen).not.toMatch(/\[\d\]/)
    expect(screen).not.toMatch(/Choose 1-\d/)
  })

  it("renders a submitted answer in Clack's collapsed style", async () => {
    const io = session(allDefaults())
    const { close } = await collectInteractively({}, io)
    close()

    // ◇ marks a SUBMITTED prompt, and the chosen label is all that survives of
    // it — the option list is gone. That collapse is the visual difference
    // between this installer and the numbered one it replaced.
    expect(visible(io.transcript())).toMatch(
      new RegExp("◇\\s+How will this site run\\?[\\s\\S]{0,40}?Docker Compose"),
    )
  })

  it("shows the hint beside the highlighted option", async () => {
    const io = session(allDefaults())
    const { close } = await collectInteractively({}, io)
    close()
    expect(visible(io.transcript())).toContain("app, database and storage together")
  })

  it("asks only what the flags left unanswered", async () => {
    const io = session([nth(2), nth(0)]) // database → mysql, redis → none

    const { answers, close } = await collectInteractively(
      { deploymentMode: "docker", packageManager: "npm", storage: "garage", adminPath: "/admin" },
      io,
    )
    close()

    expect(answers).toMatchObject({ database: "mysql", redis: "none" })
    expect(io.transcript()).not.toMatch(/Which package manager/)
    expect(io.transcript()).toMatch(/Which database/)
  })

  it("re-asks an admin path the application would refuse, and says why", async () => {
    const io = session([
      ENTER,
      ENTER,
      ENTER,
      ENTER,
      ENTER,
      "/admin-panel" + ENTER,
      // Clack KEEPS the rejected text in the field, so typing the replacement
      // without erasing first would submit "/admin-panel/manage" — still
      // reserved, and an infinite re-ask rather than a passing test.
      BACKSPACE.repeat(20) + "/manage" + ENTER,
    ])

    const { answers, close } = await collectInteractively({}, io)
    close()

    // The SAME rule the application enforces, reached through the same port
    // `adminPathParity.test.ts` pins — an installer that accepted this would
    // write a FLOWCMS_ADMIN_PATH pointing the public path at the private one.
    expect(visible(io.transcript())).toMatch(/reserved FlowCMS route/)
    expect(answers.adminPath).toBe("/manage")
  })

  it("collects external S3 credentials without echoing the secret", async () => {
    const io = session([
      nth(1), // local
      nth(0), // npm
      nth(0), // sqlite — no database URL needed
      "https://s3.example.test" + ENTER,
      "eu-west-2" + ENTER,
      "my-bucket" + ENTER,
      "AKIAEXAMPLE" + ENTER,
      "the-secret-key-value" + ENTER,
      nth(0), // no redis
      "/admin" + ENTER,
    ])

    const { answers, close } = await collectInteractively({}, io)
    close()

    expect(answers.externalStorage).toMatchObject({
      endpoint: "https://s3.example.test",
      region: "eu-west-2",
      bucket: "my-bucket",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "the-secret-key-value",
    })
    // The prompt names the field; the value never reaches the screen.
    expect(io.transcript()).toContain("Secret access key")
    expect(io.transcript()).not.toContain("the-secret-key-value")
  })

  it("skips the storage question entirely in local mode", async () => {
    // Garage is a Compose service, so outside Docker there is nothing to
    // choose. Asking a question with one possible answer is worse than not
    // asking it.
    const io = session([
      nth(1), // local
      nth(0),
      nth(0),
      "https://s3.example.test" + ENTER,
      "eu-west-2" + ENTER,
      "my-bucket" + ENTER,
      "AKIA" + ENTER,
      "secret" + ENTER,
      nth(0),
      "/admin" + ENTER,
    ])
    const { answers, close } = await collectInteractively({}, io)
    close()

    expect(answers.storage).toBe("s3")
    expect(io.transcript()).not.toMatch(/Where do uploaded files go/)
  })

  it("never puts a local database URL on screen", async () => {
    const io = session([
      nth(1), // local
      nth(0), // npm
      nth(1), // postgresql — needs a URL
      "postgresql://user:hunter2@db.example.test:5432/flowcms" + ENTER,
      "https://s3.example.test" + ENTER,
      "eu-west-2" + ENTER,
      "my-bucket" + ENTER,
      "AKIAEXAMPLE" + ENTER,
      "another-secret" + ENTER,
      nth(0),
      "/admin" + ENTER,
    ])

    const { answers, close } = await collectInteractively({}, io)
    close()

    expect(answers.externalDatabaseUrl).toBe(
      "postgresql://user:hunter2@db.example.test:5432/flowcms",
    )
    expect(io.transcript()).not.toContain("hunter2")
  })

  it("refuses an empty database URL instead of accepting one", async () => {
    // The bug this pins: a bare enter used to return "", which is falsy all the
    // way down to `buildDatabaseEnv` — which then wrote
    // `postgresql://flowcms:null@localhost:5432/flowcms` into a real .env.
    const io = session([
      nth(1), // local
      nth(0), // npm
      nth(1), // postgresql
      ENTER, // nothing typed — must be refused, not accepted
      "postgresql://u:p@db.example.test:5432/flowcms" + ENTER,
      "https://s3.example.test" + ENTER,
      "eu-west-2" + ENTER,
      "my-bucket" + ENTER,
      "AKIAEXAMPLE" + ENTER,
      "s" + ENTER,
      nth(0),
      "/admin" + ENTER,
    ])

    const { answers, close } = await collectInteractively({}, io)
    close()

    expect(visible(io.transcript())).toMatch(/connection URL is required/i)
    expect(answers.externalDatabaseUrl).toBe("postgresql://u:p@db.example.test:5432/flowcms")
  })

  it("offers bundled Redis only under Docker", async () => {
    const docker = session(allDefaults())
    const { close: closeDocker } = await collectInteractively({}, docker)
    closeDocker()
    expect(visible(docker.transcript())).toContain("Bundled Redis")

    const local = session([
      nth(1), // local
      ENTER,
      ENTER,
      "https://s3.example.test" + ENTER,
      "eu-west-2" + ENTER,
      "my-bucket" + ENTER,
      "AKIA" + ENTER,
      "secret" + ENTER,
      ENTER,
      ENTER,
    ])
    const { close: closeLocal } = await collectInteractively({}, local)
    closeLocal()
    expect(visible(local.transcript())).not.toContain("Bundled Redis")
  })

  it("asks nothing about content, credentials or the owner account", async () => {
    const io = session(allDefaults())
    const { close } = await collectInteractively({}, io)
    close()

    // An installer that collected these would own data it cannot migrate.
    for (const forbidden of [/site name/i, /owner/i, /email/i, /theme/i, /analytics/i]) {
      expect(visible(io.transcript())).not.toMatch(forbidden)
    }
  })
})

describe("cancellation", () => {
  /**
   * Clack RESOLVES a cancel symbol rather than throwing, which is the one shape
   * a caller can forget to check. Forgetting it does not crash — it scaffolds a
   * project whose package manager is `Symbol(clack:cancel)`.
   */
  it("turns Ctrl+C at the first question into PromptInterrupted", async () => {
    const io = session([CTRL_C])
    await expect(collectInteractively({}, io)).rejects.toBeInstanceOf(PromptInterrupted)
  })

  it("turns Ctrl+C at a later question into PromptInterrupted too", async () => {
    const io = session([ENTER, ENTER, CTRL_C])
    await expect(collectInteractively({}, io)).rejects.toBeInstanceOf(PromptInterrupted)
  })

  it("carries a message that names no configuration", async () => {
    // The operator interrupted; there is nothing to report but the fact of it.
    const io = session([CTRL_C])
    await expect(collectInteractively({}, io)).rejects.toThrow(/Nothing was written/)
  })

  it("never returns Clack's cancel symbol as an answer", async () => {
    const io = session([CTRL_C])
    let settled: unknown = null
    try {
      settled = await collectInteractively({}, io)
    } catch (error) {
      settled = error
    }
    expect(settled).toBeInstanceOf(PromptInterrupted)
  })
})

describe("the confirmation", () => {
  it("treats a bare enter as yes", async () => {
    const io = session([...allDefaults(), ENTER])
    const created = await collectInteractively({}, io)
    expect(await confirmAndClose(created, "Create the project?")).toBe(true)
  })

  it("takes no for an answer", async () => {
    // Right then enter moves off the default Yes.
    const io = session([...allDefaults(), RIGHT + ENTER])
    const created = await collectInteractively({}, io)
    expect(await confirmAndClose(created, "Create the project?")).toBe(false)
  })

  it("treats a cancelled confirmation as an interruption", async () => {
    const io = session([...allDefaults(), CTRL_C])
    const created = await collectInteractively({}, io)
    await expect(confirmAndClose(created, "Create the project?")).rejects.toBeInstanceOf(
      PromptInterrupted,
    )
  })

  it("closes the session even when the answer was no", async () => {
    const io = session([...allDefaults(), RIGHT + ENTER])
    const created = await collectInteractively({}, io)
    let closed = false
    const wrapped = { ...created, close: () => { closed = true; created.close() } }

    await confirmAndClose(wrapped, "Create the project?")
    expect(closed).toBe(true)
  })
})
