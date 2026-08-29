/**
 * Talking to Docker Compose from Node, portably.
 *
 * Everything here is `spawn` with an argument ARRAY and `shell: false`. No
 * string interpolation into a command line, so there is no shell to quote for
 * and the same call behaves identically under PowerShell, cmd, bash and zsh —
 * which is the whole reason the orchestration is Node rather than a `.sh` the
 * Windows half of the project could not run.
 */

import { spawn } from "node:child_process"
import { ROOT } from "./localEnv.mjs"

/**
 * The two files, in order. `compose.dev.yml` is an OVERLAY: it does not repeat
 * the base configuration, it replaces the build target, the command and the
 * mounts, so it is meaningless on its own and must always follow `compose.yml`.
 */
export const COMPOSE_FILES = ["compose.yml", "compose.dev.yml"]

/** `-f compose.yml -f compose.dev.yml`, as argv. */
export const composeFileArgs = () => COMPOSE_FILES.flatMap((file) => ["-f", file])

/**
 * Compose's interpolation environment.
 *
 * The generated values are merged OVER `process.env` because they were resolved
 * with the shell layer already given priority — see `ensureLocalEnvironment`.
 * By the time a value reaches here it is either what the shell said, what
 * `.env` said, or generated, and re-consulting the shell would only reintroduce
 * an empty string that the resolver deliberately treated as unset.
 */
export const composeEnv = (values) => ({ ...process.env, ...values })

/**
 * Run `docker compose …` attached to this terminal, resolving to its exit code.
 * Never rejects on a non-zero exit — a failed `up` is an outcome to report, not
 * an exception to stringify.
 */
export function runCompose(args, values, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("docker", ["compose", ...composeFileArgs(), ...args], {
      cwd: ROOT,
      stdio: "inherit",
      env: composeEnv(values),
      ...options,
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => resolvePromise(signal ? 1 : (code ?? 1)))
  })
}

/** Run a docker command and capture stdout. Rejects with stderr on failure. */
export function capture(command, args, values = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: composeEnv(values),
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(stdout)
      else reject(new Error(stderr.trim() || `${command} exited ${code}`))
    })
  })
}

/**
 * Fail early and in words, rather than letting `spawn` surface ENOENT.
 *
 * "docker is not installed or not running" is a sentence a developer can act
 * on. `Error: spawn docker ENOENT` is one they have to search for.
 */
export async function requireDocker() {
  try {
    await capture("docker", ["version", "--format", "{{.Server.Version}}"])
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      "Docker does not appear to be available.\n\n" +
        "Start Docker Desktop (or the Docker daemon) and try again.\n" +
        `Reported: ${detail.split("\n")[0]}`,
    )
  }
}

/**
 * The resolved Compose project name and volume topology.
 *
 * Read from `docker compose config` rather than assumed. The project name
 * decides the real name of every volume, and it has four possible sources —
 * `-p`, `COMPOSE_PROJECT_NAME`, the `name:` field, the directory name. Guessing
 * it is how a reset command ends up removing nothing, or removing something
 * belonging to a different project.
 */
export async function readComposeProject(values) {
  const json = await capture(
    "docker",
    ["compose", ...composeFileArgs(), "config", "--format", "json"],
    values,
  )
  const config = JSON.parse(json)
  return {
    name: config.name,
    volumeKeys: Object.keys(config.volumes ?? {}),
    services: config.services ?? {},
  }
}

/**
 * The real name of one Compose-managed volume, or null when it does not exist.
 *
 * Resolved by LABEL, not by string-concatenating `${project}_${key}`. Compose
 * stamps `com.docker.compose.project` and `com.docker.compose.volume` on every
 * volume it creates, so this asks Docker which volume *is* the one rather than
 * computing a name that a `name:` override would make wrong. A miss returns
 * null, which is a valid state — nothing has created the volume yet.
 */
export async function findComposeVolume(project, volumeKey) {
  const stdout = await capture("docker", [
    "volume",
    "ls",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--filter",
    `label=com.docker.compose.volume=${volumeKey}`,
    "--format",
    "{{.Name}}",
  ])
  const names = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return names[0] ?? null
}
