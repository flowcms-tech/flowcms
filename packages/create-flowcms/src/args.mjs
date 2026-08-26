/**
 * Argument parsing for `create-flowcms`.
 *
 * Hand-written, and deliberately so. The CLI takes one positional and three
 * flags; a parsing library would be a dependency, a version to track and a
 * surface of behaviours nobody chose, bought for something forty lines does
 * exactly.
 *
 * UNKNOWN FLAGS ARE AN ERROR, never ignored. A scaffolder that silently accepts
 * `--skipinstall` runs an install the operator asked it not to, and the only
 * symptom is a wait. The same rule catches every Phase 7.4 flag typed a phase
 * early.
 */

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"]
export const DEPLOYMENT_MODES = ["docker", "local"]
export const DATABASES = ["sqlite", "postgresql", "mysql", "mariadb"]
export const STORAGE_MODES = ["garage", "s3"]
export const REDIS_MODES = ["none", "bundled", "external"]

/**
 * Flags that take a value from a fixed set.
 *
 * Declared as data rather than as a switch arm each, because every one of them
 * behaves identically: reject an unknown value by name, accept `--flag value`
 * or `--flag=value`, and record it. A new deployment choice is a row here.
 *
 * DELIBERATELY ABSENT: any flag carrying a secret. No `--auth-secret`, no
 * `--db-password`, no `--s3-secret-key`. A secret in a flag is a secret in
 * shell history, in `ps` output and in a CI log. Generated secrets are
 * generated internally; external credentials come from a masked prompt or from
 * installer-namespaced environment variables.
 */
const ENUM_FLAGS = {
  "--package-manager": { key: "packageManager", values: PACKAGE_MANAGERS },
  "--deployment": { key: "deploymentMode", values: DEPLOYMENT_MODES },
  "--database": { key: "database", values: DATABASES },
  "--storage": { key: "storage", values: STORAGE_MODES },
  "--redis": { key: "redis", values: REDIS_MODES },
}

/** Flags that take free text, validated later by `validateConfig`. */
const VALUE_FLAGS = {
  "--admin-path": "adminPath",
  "--base-url": "baseUrl",
}

/** Thrown for anything the operator can fix by retyping the command. */
export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = "UsageError"
  }
}

export const HELP = `
create-flowcms — create a new FlowCMS site

Usage
  create-flowcms <project-directory> [options]

Arguments
  <project-directory>   Where to create the project. Must not exist, or must be
                        an empty directory. Relative or absolute.

Deployment
  --deployment <docker|local>
                        Docker Compose, or a Node process you run yourself.
                        Default: docker
  --database <sqlite|postgresql|mysql|mariadb>
                        Default: sqlite
  --storage <garage|s3> Bundled Garage, or an external S3-compatible endpoint.
                        Default: garage in Docker, s3 locally. There is no
                        local-filesystem media backend.
  --redis <none|bundled|external>
                        Default: none — the login rate limiter falls back to a
                        per-process implementation, which suits one instance.
  --admin-path <path>   Where the admin panel is served. Default: /admin
  --base-url <url>      Public site URL. Default: http://localhost:3000

Project
  --package-manager <npm|pnpm|yarn|bun>
                        Also decides the lockfile and the Docker install step.
                        bun installs dependencies; the site still runs on Node.
                        Default: npm
  --skip-install        Scaffold only. Prints the install command instead of
                        running it.

Other
  -h, --help            Show this help.
  -v, --version         Show the create-flowcms version.

Invoking through a package manager
  npx create-flowcms@latest my-site
  npm create flowcms@latest my-site -- --database sqlite
  pnpm create flowcms my-site
  yarn create flowcms my-site
  bun create flowcms my-site

  npm parses its own flags first, so options for this CLI go after "--". A bare
  "--" is accepted and ignored, whichever manager forwarded it.

Anything not given is asked for when the terminal is interactive, and is an
error when it is not — the installer never guesses at infrastructure.

Secrets are never flags. AUTH_SECRET, CAPTCHA_SECRET, FLOWCMS_SETUP_TOKEN,
PREVIEW_SECRET and any managed database or Garage credentials are generated and
written to the project's .env. External S3 and Redis credentials are asked for
without echo, or read from FLOWCMS_INSTALL_* environment variables. See
docs/distribution/create-flowcms.md.

After scaffolding, the site still needs its first owner: start it, open /setup,
and use the FLOWCMS_SETUP_TOKEN from your .env.
`.trim()

/**
 * `--flag value` or `--flag=value`, without a per-flag branch for each form.
 *
 * Returns the inline value when there was one, so the caller knows whether to
 * consume the next argument. `--flag=` with nothing after it yields an empty
 * string, which the caller rejects — that is a flag somebody meant to fill in.
 */
function matchFlag(arg, names) {
  for (const name of names) {
    if (arg === name) return { name, inline: null }
    if (arg.startsWith(`${name}=`)) return { name, inline: arg.slice(name.length + 1) }
  }
  return null
}

/**
 * Parse argv (already sliced past node and the script path).
 *
 * Returns a plain object rather than throwing for `--help` and `--version`:
 * they are successful outcomes with exit code 0, and modelling them as errors
 * is how a `--help` ends up on stderr with a non-zero status.
 */
export function parseArgs(argv) {
  const options = {
    mode: "scaffold",
    directory: null,
    skipInstall: false,
    // Left UNSET rather than defaulted here. The difference matters: a value
    // the operator did not give is one to ask about interactively, and one to
    // refuse in a non-interactive run. Defaults are applied later, once it is
    // known whether anybody can be asked.
    packageManager: undefined,
    deploymentMode: undefined,
    database: undefined,
    storage: undefined,
    redis: undefined,
    adminPath: undefined,
    baseUrl: undefined,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === "-h" || arg === "--help") return { ...options, mode: "help" }
    if (arg === "-v" || arg === "--version") return { ...options, mode: "version" }

    // A BARE `--` IS SKIPPED, not refused.
    //
    // `create-flowcms` is invoked through four package managers and each has its
    // own idea of where its own flags stop and the scaffolder's begin:
    // `npm create flowcms@latest my-site -- --database sqlite` is the documented
    // form, and `yarn create` and `bun create` have both been observed passing a
    // separator through rather than eating it. Refusing it would mean the
    // command that works under one manager is a usage error under another, and
    // the operator has no way to tell which.
    //
    // Skipping is not the same as POSIX end-of-options: the tokens after it are
    // parsed normally, because the whole point is that everything after the
    // separator was meant for this CLI.
    if (arg === "--") continue

    if (arg === "--skip-install") {
      options.skipInstall = true
      continue
    }

    const enumFlag = matchFlag(arg, Object.keys(ENUM_FLAGS))
    if (enumFlag) {
      const { key, values } = ENUM_FLAGS[enumFlag.name]
      const value = enumFlag.inline ?? argv[++i]
      if (!value) {
        throw new UsageError(`${enumFlag.name} needs a value (${values.join(", ")}).`)
      }
      if (!values.includes(value)) {
        throw new UsageError(
          `Unknown value "${value}" for ${enumFlag.name}. Choose one of: ${values.join(", ")}.`,
        )
      }
      options[key] = value
      continue
    }

    const valueFlag = matchFlag(arg, Object.keys(VALUE_FLAGS))
    if (valueFlag) {
      const value = valueFlag.inline ?? argv[++i]
      if (!value) throw new UsageError(`${valueFlag.name} needs a value.`)
      options[VALUE_FLAGS[valueFlag.name]] = value
      continue
    }

    if (arg.startsWith("-")) {
      // A misspelled flag is a choice the operator thinks they made. Refusing
      // is what stops `--databse postgres` from quietly scaffolding SQLite.
      throw new UsageError(`Unknown option "${arg}". Run create-flowcms --help.`)
    }

    if (options.directory !== null) {
      throw new UsageError(
        `Unexpected argument "${arg}". create-flowcms takes one project directory.`,
      )
    }
    options.directory = arg
  }

  if (options.directory === null) {
    throw new UsageError("Missing project directory. Usage: create-flowcms <project-directory>")
  }

  return options
}
