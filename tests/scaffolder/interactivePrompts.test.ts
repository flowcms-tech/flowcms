import { describe, expect, it } from "vitest"
import { PassThrough } from "node:stream"
import {
  collectInteractively,
  confirmAndClose,
} from "../../packages/create-flowcms/src/prompts/interactive.mjs"

/**
 * THE PROMPTS THEMSELVES, driven rather than stubbed.
 *
 * Everything else that touches the interactive path replaces
 * `collectInteractively` with a function returning fixed answers — which is the
 * right way to test the RESOLVER, and leaves the thing being replaced with no
 * coverage at all. `choose`, `text`, `secret` and `confirm` are where an
 * operator's keystrokes become configuration, and until this file none of that
 * code had ever been executed by a test.
 *
 * WHAT THIS IS NOT. It is not a terminal. `collectInteractively` takes its
 * streams as injected dependencies, so the questions, the validation loops, the
 * defaults and the ordering are all real here; what a real TTY would add is
 * raw-mode echo behaviour, and the muting assertion below is therefore about
 * what is WRITTEN to the output stream rather than about what a terminal would
 * display.
 */

/**
 * A scripted operator: one answer per question, in order.
 *
 * The answers CANNOT simply be written up front. `readline.question()` attaches
 * a one-shot line listener, so any line that arrives while no question is
 * pending is delivered to nobody and silently dropped — writing all six at once
 * answers the first question and then waits forever for the second. So the feed
 * is driven by the output instead: when the prompt stops writing, the operator
 * types.
 */
function session(lines: string[], beforeAnswer?: (transcript: string, output: PassThrough) => void) {
  const input = new PassThrough()
  const output = new PassThrough()
  const queue = [...lines]

  let transcript = ""
  let pending: NodeJS.Timeout | null = null

  output.on("data", (chunk) => {
    transcript += String(chunk)
    if (pending) clearTimeout(pending)
    // Quiescence, not pattern-matching: a question is finished being written
    // when writing stops, whatever it looked like. That covers the muted
    // prompts too, which deliberately write almost nothing.
    pending = setTimeout(() => {
      if (queue.length === 0) return
      beforeAnswer?.(transcript, output)
      input.write(queue.shift() + "\n")
    }, 10)
  })

  return { input, output, transcript: () => transcript }
}

describe("the questions an operator actually answers", () => {
  it("collects a full Docker configuration by number", async () => {
    const io = session([
      "1", // How will this site run?      → docker
      "2", // Which package manager?       → pnpm
      "2", // Which database?              → postgresql
      "1", // Where do uploaded files go?  → garage
      "2", // Redis?                       → bundled
      "/control", // admin path
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

  it("accepts answers by name, so an operator who reads the list need not count", async () => {
    const io = session(["docker", "bun", "mariadb", "garage", "none", "/admin"])

    const { answers, close } = await collectInteractively({}, io)
    close()

    expect(answers).toMatchObject({
      deploymentMode: "docker",
      packageManager: "bun",
      database: "mariadb",
      redis: "none",
    })
  })

  it("takes the marked default when the operator just presses enter", async () => {
    const io = session(["", "", "", "", "", ""])

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

  it("asks only what the flags left unanswered", async () => {
    // Database and redis are the only gaps, so two answers must complete it.
    const io = session(["3", "1"])

    const { answers, close } = await collectInteractively(
      { deploymentMode: "docker", packageManager: "npm", storage: "garage", adminPath: "/admin" },
      io,
    )
    close()

    expect(answers).toMatchObject({ database: "mysql", redis: "none" })
    expect(io.transcript()).not.toMatch(/Which package manager/)
    expect(io.transcript()).toMatch(/Which database/)
  })

  it("re-asks rather than accepting an answer outside the list", async () => {
    const io = session(["7", "cassandra", "", "", "", "", "", ""])

    const { answers, close } = await collectInteractively({}, io)
    close()

    expect(io.transcript()).toMatch(/Choose 1-2\./)
    expect(answers.deploymentMode).toBe("docker")
  })

  it("re-asks an admin path the application would refuse, and says why", async () => {
    const io = session(["1", "1", "1", "1", "1", "/admin-panel", "/manage"])

    const { answers, close } = await collectInteractively({}, io)
    close()

    // The SAME rule the application enforces, reached through the same port
    // the parity test pins — an installer that accepted this would write a
    // FLOWCMS_ADMIN_PATH pointing the public path at the private one.
    expect(io.transcript()).toMatch(/reserved FlowCMS route/)
    expect(answers.adminPath).toBe("/manage")
  })

  it("collects external S3 credentials without putting them in the answers' way", async () => {
    // External S3 in local mode: endpoint, region, bucket, key id, then the
    // secret key — the one field that must not reach the scrollback.
    const io = session([
      "2", // local
      "1", // npm
      "1", // sqlite
      "https://s3.example.test",
      "eu-west-2",
      "my-bucket",
      "AKIAEXAMPLE",
      "the-secret-key-value",
      "1", // no redis
      "/admin",
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
    // The prompt names the field; it never repeats the value back.
    expect(io.transcript()).toContain("Secret access key")
    expect(io.transcript()).not.toContain("the-secret-key-value")
  })

  /**
   * MUTING, TESTED WHERE IT ACTUALLY HAPPENS.
   *
   * The obvious test — type a secret, assert it is absent from the transcript —
   * is worthless here, and the first version of this file contained it.
   * readline echoes typed characters only when its input is a TTY in raw mode;
   * with an injected stream NOTHING is echoed, so that assertion passes against
   * an implementation with no masking at all.
   *
   * What `secret()` really does is replace `rl.output.write` for the duration of
   * the question, so anything written while it is pending is swallowed. That is
   * a behaviour of this code rather than of the terminal, and it can be observed
   * directly: write a marker through the same stream during the secret question
   * and again afterwards, and only the second one should appear.
   *
   * Echo suppression on a REAL terminal is a property of readline and raw mode,
   * and it is not verified by this file.
   */
  it("swallows writes made while a secret question is pending, and only then", async () => {
    const DURING = "MARKER-DURING-SECRET"
    const AFTER = "MARKER-AFTER-SECRET"
    let probedDuring = false
    let probedAfter = false

    const io = session(
      [
        "2", // local
        "1", // npm
        "2", // postgresql — needs a URL, since there is no Compose service to create
        "postgresql://user:hunter2@db.example.test:5432/flowcms",
        "https://s3.example.test",
        "eu-west-2",
        "my-bucket",
        "AKIAEXAMPLE",
        "another-secret",
        "1", // no redis
        "/admin",
      ],
      (transcript, output) => {
        // The database URL is the first masked question. Probe while it waits.
        if (!probedDuring && /Connection URL for your postgresql server/.test(transcript)) {
          probedDuring = true
          output.write(DURING)
        }
        // And again once an unmasked question is on screen.
        if (probedDuring && !probedAfter && /Where should the admin panel live/.test(transcript)) {
          probedAfter = true
          output.write(AFTER)
        }
      },
    )

    const { answers, close } = await collectInteractively({}, io)
    close()

    expect(answers.externalDatabaseUrl).toBe("postgresql://user:hunter2@db.example.test:5432/flowcms")
    expect(io.transcript()).not.toContain("hunter2")

    expect(probedDuring, "the masked question was never reached").toBe(true)
    expect(probedAfter, "the unmasked question was never reached").toBe(true)
    expect(io.transcript()).not.toContain(DURING)
    expect(io.transcript()).toContain(AFTER)
  })

  it("asks nothing about content, credentials or the owner account", async () => {
    const io = session(["", "", "", "", "", ""])
    const { close } = await collectInteractively({}, io)
    close()

    // An installer that collected these would own data it cannot migrate.
    for (const forbidden of [/site name/i, /owner/i, /email/i, /password/i, /theme/i, /analytics/i]) {
      expect(io.transcript()).not.toMatch(forbidden)
    }
  })
})

describe("the confirmation", () => {
  it("treats a bare enter as yes", async () => {
    const io = session(["", "", "", "", "", "", ""])
    const created = await collectInteractively({}, io)
    expect(await confirmAndClose(created, "Create the project?")).toBe(true)
  })

  it("takes no for an answer", async () => {
    const io = session(["", "", "", "", "", "", "n"])
    const created = await collectInteractively({}, io)
    expect(await confirmAndClose(created, "Create the project?")).toBe(false)
  })

  it("closes the terminal even when the answer was no", async () => {
    const io = session(["", "", "", "", "", "", "no"])
    const created = await collectInteractively({}, io)
    let closed = false
    const wrapped = { ...created, close: () => { closed = true; created.close() } }

    await confirmAndClose(wrapped, "Create the project?")
    expect(closed).toBe(true)
  })
})
