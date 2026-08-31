import { select, text, password, confirm, isCancel, intro } from "@clack/prompts"
import { validateAdminPath } from "../config/adminPath.mjs"

/**
 * The interactive installer.
 *
 * WHY THIS IS NOW A DEPENDENCY, having been the one file that argued hardest
 * against having one. Every earlier revision said that seven questions did not
 * justify a supply chain, and for a LINE-ORIENTED prompt that was true: read a
 * line, compare it to a list, re-ask. It stopped being true the moment the
 * questions had to be NAVIGABLE. Arrow keys, a redrawn option list, a cursor
 * hidden and restored, answers that collapse to one line when submitted, masked
 * input that is masked by drawing rather than by racing an echo, and a
 * cancellation that arrives as a resolved value rather than an exception — that
 * is a terminal UI toolkit, and a hand-rolled one is where a rendering bug
 * lands on somebody else's terminal instead of in a test.
 *
 * `@clack/prompts` is the ONLY dependency this package has.
 * `tests/scaffolder/deploymentCli.test.ts` pins it to exactly one and fails on
 * the second, so the rule that was "zero" is now "one, named" rather than
 * "whatever anyone adds next".
 *
 * WHAT DID NOT CHANGE, and must not:
 *   - the signature, the `{ answers, confirm, close }` return, and the
 *     `deps.input` / `deps.output` seam every other suite drives this through
 *   - the ORDER of the questions and every condition that skips one
 *   - `PromptInterrupted`, which `cli.mjs` turns into exit code 130
 *   - that nothing here writes a file, and nothing here echoes a credential
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

/**
 * Ctrl+C or Escape at a question.
 *
 * Clack does not throw for either. It RESOLVES with a cancel symbol, which is
 * the one shape a caller can forget to check — and forgetting it does not
 * crash, it scaffolds. An unchecked cancel becomes `Symbol(clack:cancel)`
 * stored as somebody's package manager, carried through validation as a value
 * that is neither a string nor absent, and written into a project.
 *
 * So every prompt in this file goes through `ask()`, which is the only place
 * that symbol is allowed to exist, and it is converted into the exception
 * `cli.mjs` already knows how to exit 130 for. That path is shared with the
 * SIGINT handler in the bin, which keeps ONE meaning of "the operator stopped"
 * rather than two that can disagree about the exit code.
 */
export class PromptInterrupted extends Error {
  constructor() {
    super("Interrupted. Nothing was written.")
    this.name = "PromptInterrupted"
  }
}

/**
 * One prompt, settled either by an answer or by the terminal going away.
 *
 * TWO WAYS TO STOP, and Clack only reports one of them.
 *
 *   Ctrl+C / Escape   Clack resolves its cancel symbol. Converted below.
 *   stdin ENDS        Clack reports nothing. Its readline closes, the promise
 *                     it returned is never settled, and the installer waits
 *                     forever for a terminal that is gone.
 *
 * The readline installer rejected on the second case, and losing that would be
 * a real regression: `interactiveInterrupt.test.ts` exists because an installer
 * that hangs — or worse, exits 0 — on an abandoned terminal is one a script
 * downstream believes. So the stream's own end is raced against the prompt, and
 * both roads lead to the same exception and the same exit code 130.
 *
 * The listeners are removed once the race settles, so the ordinary path leaves
 * nothing attached and a ten-question run does not accumulate ten listeners on
 * `process.stdin`.
 */
function asking(input) {
  return function ask(promptPromise) {
    let onEnd
    const abandoned = new Promise((_, reject) => {
      onEnd = () => reject(new PromptInterrupted())
      input.once("end", onEnd)
      input.once("close", onEnd)
    })

    return Promise.race([promptPromise, abandoned])
      .then((answer) => {
        if (isCancel(answer)) throw new PromptInterrupted()
        return answer
      })
      .finally(() => {
        input.removeListener("end", onEnd)
        input.removeListener("close", onEnd)
      })
  }
}

/**
 * A validator for a field that HAS a default, which is not the same thing as a
 * validator for a field that does not.
 *
 * CLACK RUNS `validate` BEFORE IT SUBSTITUTES `defaultValue`, so an empty field
 * reaches the validator as `undefined` rather than as the default. A validator
 * that does not know this rejects the very value the prompt is about to supply,
 * and because a rejected prompt re-asks, the result is not a bad value — it is
 * an installer that will not accept Enter. That is precisely how this file
 * first failed its own tests: six prompts answered, and the seventh looping on
 * "That path expected a string, received undefined."
 *
 * Empty means "take the default", and the default is already known good, so
 * empty is accepted here and the real check runs only on something typed.
 */
function optional(validate) {
  return (value) => (value === undefined || value === "" ? undefined : validate(value))
}

/** A validator for a field with NO default, where empty is a real mistake. */
function required(message) {
  return (value) => (value !== undefined && String(value).trim() !== "" ? undefined : message)
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
  // Passed to every Clack call rather than letting Clack reach for
  // `process.stdin` itself. That is what keeps this module drivable from a test
  // with no terminal — the same property the readline version had, and the
  // reason `tests/scaffolder/interactivePrompts.test.ts` can send real escape
  // sequences through a PassThrough and get real answers back.
  const io = { input, output }
  // Bound to this session's stream once, so no call site below can forget it.
  const ask = asking(input)

  const answers = { ...partial }

  intro("FlowCMS — create a new site", { output })

  if (!answers.deploymentMode) {
    answers.deploymentMode = await ask(
      select({
        message: "How will this site run?",
        initialValue: "docker",
        options: [
          {
            value: "docker",
            label: "Docker Compose",
            hint: "app, database and storage together",
          },
          {
            value: "local",
            label: "Local Node",
            hint: "you provide the database and storage",
          },
        ],
        ...io,
      }),
    )
  }

  if (!answers.packageManager) {
    answers.packageManager = await ask(
      select({
        message: "Which package manager?",
        initialValue: "npm",
        options: [
          { value: "npm", label: "npm" },
          { value: "pnpm", label: "pnpm" },
          { value: "yarn", label: "yarn" },
          { value: "bun", label: "bun", hint: "installs only; the site still runs on Node" },
        ],
        ...io,
      }),
    )
  }

  if (!answers.database) {
    answers.database = await ask(
      select({
        message: "Which database?",
        initialValue: "sqlite",
        options: [
          { value: "sqlite", label: "SQLite", hint: "a file; no server to run" },
          { value: "postgresql", label: "PostgreSQL" },
          { value: "mysql", label: "MySQL" },
          { value: "mariadb", label: "MariaDB" },
        ],
        ...io,
      }),
    )
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
    answers.externalDatabaseUrl = await ask(
      password({
        message: `Connection URL for your ${answers.database} server`,
        // REQUIRED, and refused HERE rather than three modules later. An empty
        // answer used to travel all the way to `buildDatabaseEnv`, which fell
        // through to the managed branch and wrote a literal `null` password
        // into a real `.env`. `validateConfig` now refuses that too; this is
        // the copy that lets an operator fix it by typing rather than by
        // re-running the whole command.
        validate: required("A connection URL is required."),
        ...io,
      }),
    )
  }

  if (!answers.storage) {
    // THE CHOICE IS INFRASTRUCTURE, NOT A DRIVER. "Bundled Garage" and
    // "External S3-compatible" are two ways to have an S3 endpoint and both run
    // STORAGE_DRIVER=s3; only "Local filesystem" changes which driver runs.
    //
    // Garage is offered ONLY under Docker because it is a Compose service —
    // there is nothing for a Local Node install to start.
    const storageOptions =
      answers.deploymentMode === "local"
        ? [
            {
              value: "local",
              label: "Local filesystem",
              hint: "a directory beside the app; single-node",
            },
            {
              value: "s3",
              label: "External S3-compatible",
              hint: "AWS, R2, B2, Wasabi, Spaces…",
            },
          ]
        : [
            {
              value: "garage",
              label: "Bundled Garage",
              hint: "self-hosted object storage, runs beside the app",
            },
            {
              value: "local",
              label: "Local filesystem",
              hint: "a directory on the /data volume; single-node",
            },
            {
              value: "s3",
              label: "External S3-compatible",
              hint: "AWS, R2, B2, Wasabi, Spaces…",
            },
          ]

    answers.storage = await ask(
      select({
        message: "Where do uploaded files go?",
        initialValue: answers.deploymentMode === "local" ? "local" : "garage",
        options: storageOptions,
        ...io,
      }),
    )
  }

  if (answers.storage === "s3" && !answers.externalStorage) {
    answers.externalStorage = {
      endpoint: await ask(
        text({
          message: "S3 endpoint URL",
          placeholder: "https://s3.amazonaws.com",
          defaultValue: "https://s3.amazonaws.com",
          // The message never quotes the input: an endpoint may carry
          // credentials in its userinfo, and a rejected value echoed back is a
          // credential in the scrollback.
          validate: optional((value) => (isUrl(value) ? undefined : "That is not a valid URL.")),
          ...io,
        }),
      ),
      region: await ask(
        text({ message: "Region", placeholder: "us-east-1", defaultValue: "us-east-1", ...io }),
      ),
      bucket: await ask(
        text({ message: "Bucket name", placeholder: "flowcms", defaultValue: "flowcms", ...io }),
      ),
      accessKeyId: await ask(
        text({
          message: "Access key ID",
          validate: required("An access key ID is required."),
          ...io,
        }),
      ),
      secretAccessKey: await ask(
        password({
          message: "Secret access key",
          validate: required("A secret access key is required."),
          ...io,
        }),
      ),
    }
  }

  if (!answers.redis) {
    const options = [{ value: "none", label: "No Redis", hint: "fine for a single instance" }]
    if (answers.deploymentMode === "docker") {
      options.push({ value: "bundled", label: "Bundled Redis", hint: "runs beside the app" })
    }
    options.push({ value: "external", label: "External Redis", hint: "you provide the URL" })

    answers.redis = await ask(
      select({
        message: "Redis, for rate limiting across replicas?",
        initialValue: "none",
        options,
        ...io,
      }),
    )
  }

  if (answers.redis === "external" && !answers.redisUrl) {
    answers.redisUrl = await ask(
      password({
        message: "Redis URL",
        validate: required("A Redis URL is required."),
        ...io,
      }),
    )
  }

  if (!answers.adminPath) {
    answers.adminPath = await ask(
      text({
        message: "Where should the admin panel live?",
        placeholder: "/admin",
        defaultValue: "/admin",
        // `optional` because this field has a default: a bare enter must mean
        // /admin, not a rejection of it.
        validate: optional((value) => {
          const result = validateAdminPath(value)
          return result.ok ? undefined : `That path ${result.reason}.`
        }),
        ...io,
      }),
    )
  }

  return {
    answers,
    confirm: (message) => ask(confirm({ message, initialValue: true, ...io })),
    // Clack owns no long-lived interface: each prompt opens its own readline
    // and closes it on submit. There is nothing left to tear down, and `close()`
    // survives only because `cli.mjs` and three suites call it — removing it
    // would be an API change for no gain.
    close: () => {},
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
