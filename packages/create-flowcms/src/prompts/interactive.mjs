import { createInterface } from "node:readline"
import { validateAdminPath } from "../config/adminPath.mjs"

/**
 * The interactive installer.
 *
 * ZERO DEPENDENCIES, STILL — and the reason is not purity. What is needed here
 * is seven single-choice questions, a text field and a masked field. Node 22's
 * `readline` covers all of it in about a hundred lines. A prompt library would
 * be a supply chain, a version to track and a breaking-change surface, bought
 * for a select list, in a package whose one distinguishing property so far is
 * that it has no dependencies at all.
 *
 * WHAT THIS MUST NOT COST is non-interactive use. Nothing here is reachable
 * unless a TTY exists AND the value was not supplied; `cli.mjs` decides that,
 * and every question below has a flag or an environment equivalent. A CI run
 * never enters this file.
 *
 * NOTHING HERE WRITES A FILE. Prompts return answers; the caller assembles a
 * configuration, validates it, and only then renders. That separation is what
 * lets the same configuration come from flags, from a future config file, or
 * from a test.
 */

/** A question the operator answers by choosing from a list. */
async function choose(rl, { question, options, defaultValue }) {
  const keys = options.map((option) => option.value)
  const defaultIndex = Math.max(0, keys.indexOf(defaultValue))

  rl.output.write(`\n${question}\n`)
  options.forEach((option, index) => {
    const marker = index === defaultIndex ? "›" : " "
    const note = option.note ? `  — ${option.note}` : ""
    rl.output.write(`  ${marker} ${index + 1}) ${option.label}${note}\n`)
  })

  for (;;) {
    const answer = (await ask(rl, `  [${defaultIndex + 1}] `)).trim()
    if (answer === "") return keys[defaultIndex]

    // By number or by name: an operator who reads "postgresql" in the list and
    // types it should not be told to count.
    const byNumber = Number.parseInt(answer, 10)
    if (Number.isInteger(byNumber) && byNumber >= 1 && byNumber <= keys.length) {
      return keys[byNumber - 1]
    }
    const byName = keys.find((key) => key.toLowerCase() === answer.toLowerCase())
    if (byName) return byName

    rl.output.write(`  Choose 1-${keys.length}.\n`)
  }
}

/** A free-text question with a default and an optional validator. */
async function text(rl, { question, defaultValue, validate }) {
  rl.output.write(`\n${question}\n`)
  for (;;) {
    const suffix = defaultValue ? ` [${defaultValue}] ` : " "
    const answer = (await ask(rl, ` ${suffix}`)).trim()
    const value = answer === "" ? defaultValue : answer

    if (!value) {
      rl.output.write("  A value is required.\n")
      continue
    }

    const problem = validate?.(value)
    if (problem) {
      // The validator's message, never the input: a rejected endpoint or URL
      // can carry credentials, and echoing it puts them in the scrollback.
      rl.output.write(`  ${problem}\n`)
      continue
    }
    return value
  }
}

/**
 * A field whose answer must not appear on screen.
 *
 * Used for S3 secret keys and any database URL typed whole, because a URL
 * carries a password in its userinfo. The muting works by intercepting
 * readline's own writes for the duration of the question — the characters still
 * reach the process, they just never reach the terminal, so nothing lands in a
 * scrollback buffer, a screen share or a screenshot.
 */
async function secret(rl, { question }) {
  rl.output.write(`\n${question}\n`)

  // MASKING IS NOT ALWAYS POSSIBLE, AND A SILENT FAILURE HERE IS THE WORST KIND.
  //
  // The interception below suppresses READLINE's echo, which only exists while
  // the interface is in terminal mode. When it is not — a real terminal on
  // stdin but stdout redirected to a file or a pipe, which is exactly how
  // somebody captures an install log — the TTY driver does the echoing in the
  // kernel and nothing in this process can stop it. The characters appear on
  // screen and this code cannot tell.
  //
  // Saying so costs one line and lets the operator decide. Promising masking
  // that is not happening costs them a credential rotation.
  if (rl.input?.isTTY && !rl.terminal) {
    rl.output.write(
      "  WARNING: this terminal is not in a mode where input can be hidden.\n" +
        "  What you type will be visible. Use FLOWCMS_INSTALL_* environment\n" +
        "  variables instead if that matters.\n",
    )
  }

  const output = rl.output
  const originalWrite = output.write.bind(output)
  let muted = false

  output.write = (chunk, ...rest) => {
    if (!muted) return originalWrite(chunk, ...rest)
    // Keep the newline that ends the answer; swallow the echoed characters.
    if (typeof chunk === "string" && (chunk === "\n" || chunk === "\r\n")) {
      return originalWrite(chunk, ...rest)
    }
    return true
  }

  try {
    originalWrite("  ")
    muted = true
    const answer = await ask(rl, "")
    return answer.trim()
  } finally {
    muted = false
    output.write = originalWrite
  }
}

/**
 * Ctrl+C during a question, which readline does NOT hand to the process.
 *
 * A readline interface in terminal mode intercepts Ctrl+C itself. With no
 * `SIGINT` listener attached it simply closes the interface — the process-level
 * handler in `bin/create-flowcms.mjs` never runs, the promise `ask()` is
 * waiting on is never settled, and the CLI exits **0 having written nothing**.
 * An installer that reports success for an interrupted run is worse than one
 * that hangs, because a script downstream believes it.
 *
 * So the interface gets a listener, every pending question is settled when the
 * interface closes, and `cli.mjs` turns this into exit code 130 — the same code
 * the signal handler in the bin uses, for the same event.
 */
export class PromptInterrupted extends Error {
  constructor() {
    super("Interrupted. Nothing was written.")
    this.name = "PromptInterrupted"
  }
}

/**
 * One question, settled either by an answer or by the terminal going away.
 *
 * The close listener is removed as soon as the answer arrives, so the ordinary
 * `session.close()` at the end of a run — which happens with no question
 * pending — settles nothing and rejects nothing.
 */
function ask(rl, prompt) {
  return new Promise((resolve, reject) => {
    const onClose = () => reject(new PromptInterrupted())
    rl.once("close", onClose)
    rl.question(prompt, (answer) => {
      rl.removeListener("close", onClose)
      resolve(answer)
    })
  })
}

async function confirm(rl, question, defaultYes = true) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]"
  for (;;) {
    const answer = (await ask(rl, `\n${question} ${suffix} `)).trim().toLowerCase()
    if (answer === "") return defaultYes
    if (["y", "yes"].includes(answer)) return true
    if (["n", "no"].includes(answer)) return false
  }
}

/**
 * Ask for whatever the flags did not already answer.
 *
 * The order is the order an operator thinks in: where it runs, what runs it,
 * then the three infrastructure choices, then the one cosmetic one. Storage is
 * asked after deployment because Garage is only an option in Docker.
 *
 * Questions the installer deliberately does NOT ask: site name, owner email,
 * owner password, theme, content, SEO, analytics, third-party credentials.
 * Those are CMS state and belong to `/setup` and the admin panel; an installer
 * that collected them would be owning data it cannot migrate.
 */
export async function collectInteractively(partial, deps = {}) {
  const input = deps.input ?? process.stdin
  const output = deps.output ?? process.stdout
  const rl = createInterface({ input, output })
  rl.output = output

  // Without this listener readline treats Ctrl+C as "close the interface" and
  // says nothing. With it, the interrupt is visible: the line is ended so the
  // shell prompt does not land on top of a half-written question, the interface
  // closes, and `ask()` rejects with PromptInterrupted.
  rl.on("SIGINT", () => {
    output.write("\n")
    rl.close()
  })

  try {
    output.write("\nFlowCMS — deployment configuration\n")
    output.write("Press enter to accept the suggested answer (›).\n")

    const answers = { ...partial }

    if (!answers.deploymentMode) {
      answers.deploymentMode = await choose(rl, {
        question: "How will this site run?",
        defaultValue: "docker",
        options: [
          { value: "docker", label: "Docker Compose", note: "app, database and storage together" },
          { value: "local", label: "Local Node", note: "you provide the database and storage" },
        ],
      })
    }

    if (!answers.packageManager) {
      answers.packageManager = await choose(rl, {
        question: "Which package manager?",
        defaultValue: "npm",
        options: [
          { value: "npm", label: "npm" },
          { value: "pnpm", label: "pnpm" },
          { value: "yarn", label: "yarn" },
          { value: "bun", label: "bun", note: "installs only; the site still runs on Node" },
        ],
      })
    }

    if (!answers.database) {
      answers.database = await choose(rl, {
        question: "Which database?",
        defaultValue: "sqlite",
        options: [
          { value: "sqlite", label: "SQLite", note: "a file; no server to run" },
          { value: "postgresql", label: "PostgreSQL" },
          { value: "mysql", label: "MySQL" },
          { value: "mariadb", label: "MariaDB" },
        ],
      })
    }

    // An external database for a local deployment: the installer has no server
    // to create, so it needs the URL. In Docker it creates one and generates
    // the credentials itself.
    const needsDatabaseUrl =
      answers.database !== "sqlite" &&
      answers.deploymentMode === "local" &&
      !answers.externalDatabaseUrl

    if (needsDatabaseUrl) {
      // Masked: a database URL carries its password in the userinfo.
      answers.externalDatabaseUrl = await secret(rl, {
        question:
          `Connection URL for your ${answers.database} server.\n` +
          "  It is not echoed, and it is written only to .env.",
      })
    }

    if (!answers.storage) {
      answers.storage =
        answers.deploymentMode === "local"
          ? "s3"
          : await choose(rl, {
              question: "Where do uploaded files go?",
              defaultValue: "garage",
              options: [
                { value: "garage", label: "Bundled Garage", note: "self-hosted, runs beside the app" },
                { value: "s3", label: "External S3-compatible", note: "AWS, R2, B2, Wasabi, Spaces…" },
              ],
            })
    }

    if (answers.storage === "s3" && !answers.externalStorage) {
      output.write(
        "\nS3-compatible storage. FlowCMS has no local-file media backend, so this\n" +
          "is required — the site starts without it but uploads will fail.\n",
      )
      answers.externalStorage = {
        endpoint: await text(rl, {
          question: "  Endpoint URL",
          defaultValue: "https://s3.amazonaws.com",
          validate: (value) => (isUrl(value) ? null : "That is not a valid URL."),
        }),
        region: await text(rl, { question: "  Region", defaultValue: "us-east-1" }),
        bucket: await text(rl, { question: "  Bucket name", defaultValue: "flowcms" }),
        accessKeyId: await text(rl, { question: "  Access key ID" }),
        secretAccessKey: await secret(rl, { question: "  Secret access key (not echoed)" }),
      }
    }

    if (!answers.redis) {
      const options = [
        { value: "none", label: "No Redis", note: "fine for a single instance" },
      ]
      if (answers.deploymentMode === "docker") {
        options.push({ value: "bundled", label: "Bundled Redis", note: "runs beside the app" })
      }
      options.push({ value: "external", label: "External Redis", note: "you provide the URL" })

      answers.redis = await choose(rl, {
        question: "Redis, for rate limiting across replicas?",
        defaultValue: "none",
        options,
      })
    }

    if (answers.redis === "external" && !answers.redisUrl) {
      answers.redisUrl = await secret(rl, {
        question: "  Redis URL (not echoed — it may contain a password)",
      })
    }

    if (!answers.adminPath) {
      answers.adminPath = await text(rl, {
        question: "Where should the admin panel live?",
        defaultValue: "/admin",
        validate: (value) => {
          const result = validateAdminPath(value)
          return result.ok ? null : `That path ${result.reason}.`
        },
      })
    }

    return {
      answers,
      confirm: (message) => confirm(rl, message),
      close: () => rl.close(),
    }
  } catch (error) {
    // A question that throws must not leave the terminal in raw mode with a
    // half-written prompt on screen.
    rl.close()
    throw error
  }
}

/**
 * Ask the confirmation, then close the terminal.
 *
 * Separate from `collectInteractively` so the caller can build and show the
 * summary — which needs the VALIDATED configuration — between the last question
 * and the confirmation. Closing here rather than there is what makes that
 * ordering possible.
 */
export async function confirmAndClose(session, message) {
  try {
    return await session.confirm(message)
  } finally {
    session.close()
  }
}

function isUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}
