import { spawn } from "node:child_process"

/**
 * The one place a package manager is turned into a command.
 *
 * Every one of these is an ARGUMENT ARRAY. Nothing here builds a string for a
 * shell to parse, which is what makes a destination path containing a space, a
 * semicolon or `$(…)` an ordinary path rather than an injection: `spawn` hands
 * the array to the OS directly, and the operator's directory name is never
 * interpreted by anything.
 *
 * The cwd is passed as an option rather than prefixed with `cd`, for the same
 * reason.
 */

const INSTALL = {
  npm: ["install"],
  pnpm: ["install"],
  yarn: ["install"],
  bun: ["install"],
}

/**
 * The command name, which is just the manager's name.
 *
 * It used to append `.cmd` on Windows, which was wrong twice over: `spawn`
 * refuses to launch a `.cmd` anyway (see `spawnableFor`), and bun is not one —
 * it ships `bun.exe`, so the guess reported bun as missing on every Windows
 * machine that had it. Extension resolution belongs to whatever launches the
 * process, not to a table here.
 */
function binaryFor(manager) {
  return manager
}

export function getInstallCommand(manager) {
  const args = INSTALL[manager]
  if (!args) throw new Error(`No install command for package manager "${manager}".`)
  return { command: binaryFor(manager), args: [...args] }
}

/** What to print when installation is skipped or fails. */
export function describeInstallCommand(manager) {
  return `${manager} install`
}

/**
 * Whether the requested package manager is on PATH.
 *
 * Asked BEFORE the project is written, so "pnpm is not installed" is a usage
 * error rather than a half-finished directory. There is deliberately no
 * fallback to a different manager: silently installing with npm when somebody
 * asked for pnpm produces a lockfile they did not want and will not notice
 * until it is committed.
 */
export function isAvailable(manager, run = defaultRun) {
  const { command } = getInstallCommand(manager)
  return run(command, ["--version"]).then(
    (result) => result.code === 0,
    () => false,
  )
}

/**
 * The version of the manager actually on PATH.
 *
 * TWO THINGS DEPEND ON KNOWING IT, and both go wrong quietly if it is guessed.
 *
 *   The generated `packageManager` field. Corepack reads it and refuses to run
 *   a version that does not exist, so an invented one turns every command in
 *   the project into an error. Phase 7.3 omitted the field for exactly this
 *   reason; now the manager is chosen, but the version still has to be observed.
 *
 *   Yarn's frozen-install flag. It is `--frozen-lockfile` in v1 and
 *   `--immutable` from v2, and the wrong one is a Docker build that fails at
 *   the install step.
 *
 * Returns nulls rather than throwing when the manager is absent or answers
 * something unexpected. A missing manager is reported separately, by
 * `isAvailable`, with a message about what to do; failing here would report it
 * as an internal error instead.
 */
export async function detectManagerVersion(manager, run = defaultRun) {
  const { command } = getInstallCommand(manager)

  try {
    const result = await run(command, ["--version"], { stdio: "capture" })
    const version = String(result.stdout ?? "").trim()
    // A bare semver line is what all four print. Anything else — a warning, a
    // corepack prompt, an empty string — is treated as "unknown" rather than
    // parsed optimistically.
    if (!/^\d+\.\d+\.\d+/.test(version)) return { version: null, major: null }
    return { version, major: Number.parseInt(version.split(".")[0], 10) }
  } catch {
    return { version: null, major: null }
  }
}

export function installDependencies(manager, cwd, run = defaultRun) {
  const { command, args } = getInstallCommand(manager)
  return run(command, args, { cwd })
}

/**
 * How a package manager is actually spawned, which on Windows is not directly.
 *
 * npm, pnpm and yarn are `.cmd` shims there, and since the fix for
 * CVE-2024-27980 (Node 18.20 / 20.12 and later) `spawn` REFUSES to launch a
 * `.cmd` unless a shell is involved — it fails with `EINVAL` before the process
 * exists. Nothing about that failure resembles its cause: `isAvailable` saw the
 * rejection, reported the manager as absent, and `create-flowcms` told the
 * operator that the npm they had just used to run it was not on their PATH.
 * Every Windows install without `--skip-install` failed that way.
 *
 * So on Windows the interpreter is named explicitly, and it — not this module —
 * decides the extension. That is also why bun works again: it ships `bun.exe`
 * rather than a `.cmd`, and any table that guessed an extension got one of the
 * four wrong.
 *
 * Naming `cmd.exe` is not `shell: true`. That option routes EVERY argument
 * through a parser; this routes one fixed string built from this module's own
 * tables — a manager name, and the literal arguments `install` or `--version`.
 * Nothing an operator typed is on this command line: their project path travels
 * as `cwd`, which is a spawn option and is never parsed. `/d` skips AutoRun
 * commands from the registry, which would otherwise execute inside the probe.
 */
function spawnableFor(command, args) {
  if (process.platform !== "win32") return { file: command, args }
  return { file: process.env.COMSPEC ?? "cmd.exe", args: ["/d", "/s", "/c", command, ...args] }
}

/**
 * The default child-process runner.
 *
 * Injected everywhere it is used, so the unit tests exercise command
 * construction and failure handling without a package manager, a registry or a
 * network. The expensive real thing runs in the artifact proof instead.
 */
export function defaultRun(command, args, options = {}) {
  // "capture" is this module's own word, not a child_process one: it means
  // "give me stdout back". Version probing needs the output; an install does
  // not, and inheriting the terminal is what an operator expects from it.
  const capture = options.stdio === "capture"
  const spawned = spawnableFor(command, args)

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(spawned.file, spawned.args, {
      cwd: options.cwd,
      stdio: capture ? ["ignore", "pipe", "ignore"] : (options.stdio ?? "ignore"),
      // NEVER true. With a shell, every character of a path the operator typed
      // becomes syntax.
      shell: false,
      env: process.env,
    })
    let stdout = ""
    if (capture) child.stdout?.on("data", (chunk) => { stdout += chunk })

    child.on("error", rejectPromise)
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout }))
  })
}
