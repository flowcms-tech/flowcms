import { readFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { HELP, UsageError, parseArgs } from "./args.mjs"
import { inspectDestination } from "./destination.mjs"
import { deriveProjectName } from "./projectName.mjs"
import {
  describeInstallCommand,
  installDependencies,
  isAvailable,
} from "./packageManager.mjs"
import {
  copyTemplate,
  cleanUpOwnedPath,
  renderPackageJson,
  writeJson,
} from "./scaffold.mjs"
import { resolveConfig } from "./config/resolve.mjs"
import { ConfigError, buildSafeSummary, formatSummary } from "./config/validate.mjs"
import { PromptInterrupted, confirmAndClose } from "./prompts/interactive.mjs"
import { applyConfiguration } from "./render/project.mjs"
import { composeUpCommand } from "./render/compose.mjs"
import { detectManagerVersion } from "./packageManager.mjs"

/**
 * `create-flowcms` — generate a standalone FlowCMS application.
 *
 * WHAT IT IS NOT: an installer that runs `npm init` and adds `flowcms` as a
 * dependency. FlowCMS is an application, not a library you assemble around; the
 * `flowcms` package is its public THEME API and nothing more. The generated
 * project is the application, copied.
 *
 * THE ORDER OF OPERATIONS IS THE SAFETY MODEL. Everything that can be checked
 * without writing is checked first — the destination, the project name, the
 * package manager's existence, the template's integrity — so the common
 * failures happen with the filesystem untouched. Only then does anything get
 * created.
 *
 * PATHS COME FROM THIS FILE'S OWN LOCATION, never from `process.cwd()`. The
 * package is installed into a directory nobody chose (npx's cache, a global
 * prefix, a temp unpack) and run from a directory unrelated to it.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, "..")
const TEMPLATE_DIR = join(PACKAGE_ROOT, "template")

function readPackageVersion() {
  // Read, not imported: a JSON import needs an assertion whose syntax has moved
  // twice, and this file has to run on whatever Node the operator has.
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version
}

/** The template's own build stamp, written by scripts/build-create-flowcms.mjs. */
function readTemplateStamp() {
  const stampPath = join(PACKAGE_ROOT, "template.json")
  if (!existsSync(stampPath)) {
    throw new Error(
      "This create-flowcms install has no application template. The package was " +
        "built or packed incorrectly.",
    )
  }
  return JSON.parse(readFileSync(stampPath, "utf8"))
}

/**
 * The default collaborators, replaced in tests.
 *
 * A seam rather than a mock: what needs exercising is the ORCHESTRATION — that
 * a failed install leaves the project standing and says how to finish it, that
 * a failed copy removes only what this process made. Both are decisions about
 * somebody's filesystem, and neither should need a package manager, a registry
 * or a network to verify.
 */
const REAL = {
  isAvailable,
  installDependencies: (manager, cwd, io) => installDependencies(manager, cwd, verboseRun(io)),
  // Overridden only to exercise the failure path. The first version of that
  // test renamed the real template directory aside, which raced with every
  // other test reading it and failed with EPERM on Windows — a shared mutable
  // fixture pretending to be an injection.
  templateDir: TEMPLATE_DIR,
}

/**
 * Collaborators a caller may override. Merged over the real ones, never replaced.
 *
 * Only the first three are consumed in this file. The rest are forwarded
 * untouched to `resolveConfig`, which reads `env`, `isInteractive`, `prompt` and
 * `generateSecrets`, and passes the same object on to `collectInteractively`,
 * which reads `input` and `output`.
 *
 * They are all listed here because **TypeScript treats a JSDoc object type as
 * closed**: a dependency that is genuinely supported but missing from this list
 * is an excess-property error at every call site that passes it. That is not
 * hypothetical — `tests/scaffolder/interactiveInterrupt.test.ts` failed
 * `tsc --noEmit` for exactly that reason, against a seam `resolveConfig` has
 * always honoured. One typedef, referenced twice, so the two entry points
 * cannot drift apart again.
 *
 * @typedef  {object}   CliDeps
 * @property {Function} [isAvailable]         probes whether a package manager is on PATH
 * @property {Function} [installDependencies] performs the install step
 * @property {string}   [templateDir]         where the application template is copied from
 * @property {object}   [env]                 environment read for `FLOWCMS_INSTALL_*` values
 * @property {Function} [isInteractive]       whether to prompt; defaults to a real TTY check
 * @property {Function} [prompt]              the interactive collector
 * @property {Function} [generateSecrets]     deployment-secret generator
 * @property {object}   [input]               prompt input stream; defaults to process.stdin
 * @property {object}   [output]              prompt output stream; defaults to process.stdout
 * @property {Function} [run]                 child-process runner used for version detection
 */

/**
 * @param {string[]} argv
 * @param {{ log: (message?: unknown) => void, error: (message?: unknown) => void }} [io]
 * @param {CliDeps} [deps]
 * @returns {Promise<number>} the process exit code
 */
export async function run(argv, io = console, deps = {}) {
  // Merged, not replaced. A caller overrides the one collaborator its test is
  // about and inherits the rest — otherwise `{ templateDir }` would arrive with
  // no `isAvailable`, and would happen to work only because --skip-install
  // returns before that line is reached.
  const { isAvailable: available, installDependencies: install, templateDir } = { ...REAL, ...deps }
  const options = parseArgs(argv)

  if (options.mode === "help") {
    io.log(HELP)
    return 0
  }
  if (options.mode === "version") {
    io.log(readPackageVersion())
    return 0
  }

  const stamp = readTemplateStamp()
  const destination = inspectDestination(options.directory)
  const projectName = deriveProjectName(destination.path)

  // EVERYTHING IS DECIDED BEFORE ANYTHING IS WRITTEN. Configuration is
  // collected, defaulted and validated first, so a contradictory answer or a
  // missing credential costs a retype rather than a half-created directory
  // the operator has to clean up.
  const { config, session } = await resolveConfig({ ...options, projectName }, deps)

  // The manager's own version, observed rather than assumed. It decides the
  // packageManager field and yarn's install flag, which changed at v2.
  const observed = await detectManagerVersion(config.packageManager, deps.run)
  const resolved = {
    ...config,
    packageManagerVersion: observed.version,
    yarnMajor: observed.major ?? 1,
  }

  if (!options.skipInstall && !(await available(resolved.packageManager))) {
    if (session) session.close()
    throw new UsageError(
      `${resolved.packageManager} was requested but is not available on PATH. ` +
        `Install it, choose another with --package-manager, or pass --skip-install.`,
    )
  }

  // The summary is built from a WHITELIST of non-sensitive fields, so it
  // cannot show a secret even if one were added to the configuration later.
  io.log("")
  io.log(formatSummary(buildSafeSummary(resolved)))

  if (session) {
    const proceed = await confirmAndClose(session, "Create the project with this configuration?")
    if (!proceed) {
      io.log("")
      io.log("Nothing was written.")
      return 0
    }
  }

  io.log("")
  io.log(`Creating a FlowCMS site in ${destination.path}`)

  let created = false
  try {
    if (!destination.existed) {
      mkdirSync(destination.path, { recursive: true })
      created = true
    }

    io.log("  Copying the application template")
    copyTemplate(templateDir, destination.path)

    const manifestPath = join(destination.path, "package.json")
    writeJson(manifestPath, renderPackageJson(manifestPath, projectName))

    io.log("  Writing deployment configuration")
    applyConfiguration(destination.path, resolved, {
      templateVersion: stamp.templateVersion,
      cliVersion: readPackageVersion(),
    })
  } catch (error) {
    // Only what this process made. A directory the operator created and
    // handed to us is emptied, never removed.
    cleanUpOwnedPath({ path: destination.path, existed: !created })
    throw error
  }

  // FROM HERE ON THE PROJECT IS VALID AND IS NEVER DELETED — it is
  // configured, it holds real secrets, and a failed install is one command to
  // retry. Deleting it because a registry was briefly unreachable would throw
  // away the secrets it was configured with as well as the work.
  if (options.skipInstall) {
    io.log("  Skipping dependency installation (--skip-install)")
    report(io, destination.path, resolved, { installed: false })
    return 0
  }

  io.log(`  Installing dependencies with ${resolved.packageManager}`)
  const result = await install(resolved.packageManager, destination.path, io)

  if (result.code !== 0) {
    io.error("")
    io.error(`Dependency installation failed (${describeInstallCommand(resolved.packageManager)}).`)
    io.error(`The project was created at ${destination.path} and has been kept.`)
    io.error("Its configuration and generated secrets are intact — finish it with:")
    io.error(
      `  cd ${relative(process.cwd(), destination.path) || "."} && ${describeInstallCommand(resolved.packageManager)}`,
    )
    return 1
  }

  report(io, destination.path, resolved, { installed: true })
  return 0
}

/**
 * Installation output is shown, and only installation output.
 *
 * A package manager prints progress for a minute; hiding it looks like a hang,
 * and capturing it to replay on failure means holding a large buffer to
 * usually throw away. Inheriting the terminal is what the operator expects from
 * a command that runs `npm install`.
 */
function verboseRun(io) {
  return async (command, args, opts) => {
    const { defaultRun } = await import("./packageManager.mjs")
    void io
    return defaultRun(command, args, { ...opts, stdio: "inherit" })
  }
}

/**
 * What the operator is told at the end.
 *
 * SPECIFIC TO THE CONFIGURATION, because generic instructions are how
 * somebody runs an npm command in a pnpm project. The commands shown are the
 * ones this project actually uses.
 *
 * NO SECRET APPEARS HERE. The setup token is referenced by name and by where
 * to find it — a terminal scrolls into a screenshot, a screen share and a
 * support ticket, and a token pasted into one of those has to be rotated.
 */
function report(io, path, config, { installed }) {
  const where = relative(process.cwd(), path) || "."
  const pm = config.packageManager
  // `<pm> run <script>` for every manager, including `start`. The bare forms —
  // `pnpm start`, `yarn start`, `bun start` — are shorthands each manager
  // defines for itself, and `bun start` in particular is not a documented one.
  // Printing a command that is merely likely to work is how a README becomes
  // the thing the operator stops trusting.
  const runScript = (script) => (pm === "npm" ? `npm run ${script}` : `${pm} run ${script}`)

  io.log("")
  io.log(`Created ${config.projectName} in ${path}`)
  io.log("")
  io.log("Next steps:")
  io.log(`  cd ${where}`)

  if (!installed) io.log(`  ${pm} install`)

  if (config.deploymentMode === "docker") {
    if (!installed) {
      // The one combination that is not obvious: no install means no
      // lockfile, and the image build installs exactly what the lockfile
      // pins. Said here rather than discovered as a build error.
      io.log("      ^ required before the image build — it creates the lockfile")
    }
    io.log(`  ${composeUpCommand()}`)
    io.log("")
    io.log("  Your .env already names the Compose files and profiles this topology")
    io.log("  uses, so no -f flags are needed. Migrations run at container start.")
  } else {
    io.log(`  ${runScript("build:packages")}`)
    io.log(`  ${runScript("db:migrate")}`)
    io.log(`  ${runScript("build")} && ${pm === "npm" ? "npm start" : runScript("start")}`)
  }

  io.log("")
  io.log("Then create the first owner:")
  io.log(`  1. Open ${config.baseUrl}/setup`)
  io.log("  2. It asks for a setup token — yours is FLOWCMS_SETUP_TOKEN in .env")
  io.log("  3. Create the owner account and the site identity")
  io.log(`  4. Sign in at ${config.baseUrl}${config.adminPath}/login`)
  io.log("")
  io.log(".env holds this project's real secrets. It is gitignored; keep it that way.")
}

/**
 * The bin's entry point: turns outcomes into exit codes and short messages.
 *
 * @param {string[]} argv
 * @param {{ log: (message?: unknown) => void, error: (message?: unknown) => void }} [io]
 * @param {CliDeps} [deps]
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv, io = console, deps = {}) {
  try {
    return await run(argv, io, deps)
  } catch (error) {
    // Ctrl+C at a prompt. readline keeps that signal to itself, so it arrives
    // here as an error rather than at the process handler in the bin — and it
    // has to keep that handler's exit code, because the operator did the same
    // thing and the documented meaning of 130 is the same.
    if (error instanceof PromptInterrupted) {
      io.error("")
      io.error("Interrupted. Nothing was written.")
      return 130
    }
    if (error instanceof UsageError) {
      io.error(error.message)
      return 2
    }
    // A configuration the operator can fix by answering differently. Reported
    // like a usage error because that is what it is — and with every problem at
    // once, so three mistakes cost one run rather than three.
    if (error instanceof ConfigError) {
      io.error("This configuration cannot be used:")
      for (const problem of error.problems) io.error(`  - ${problem}`)
      return 2
    }
    // Everything else is a bug or a broken environment. The message, not the
    // stack — a stack trace full of paths inside an npx cache tells the
    // operator nothing they can act on.
    io.error(error?.message ?? String(error))
    if (process.env.CREATE_FLOWCMS_DEBUG === "1" && error?.stack) io.error(error.stack)
    return 1
  }
}
