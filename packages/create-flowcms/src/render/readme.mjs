import { composeUpCommand } from "./compose.mjs"
import { LOCKFILES, localInstallCommand } from "./dockerfile.mjs"
import { describeDatabase } from "../config/database.mjs"
import { describeStorage, localStoragePathFor } from "../config/storage.mjs"
import { describeRedis } from "../config/redis.mjs"

/**
 * The generated project's README, written from the actual configuration.
 *
 * Phase 7.3's README was generic because the scaffolder knew nothing. This one
 * knows, so it says `pnpm install` to a pnpm project and shows the admin path
 * the operator chose. A README that tells somebody to run the wrong command is
 * worse than no README: it is confidently wrong at the moment they trust it
 * most.
 *
 * NO SECRET APPEARS HERE. The setup token is referenced by NAME and by where to
 * find it; its value stays in `.env`.
 */
export function buildReadme(config) {
  const isDocker = config.deploymentMode === "docker"
  const pm = config.packageManager
  const install = localInstallCommand(pm)
  const run = (script) => (pm === "npm" ? `npm run ${script}` : `${pm} run ${script}`)

  const lines = []

  lines.push(`# ${config.projectName}`)
  lines.push("")
  lines.push(
    "A **standalone FlowCMS site**, created by `create-flowcms`. Nothing in it",
    "points back at the FlowCMS repository — commit it, change it and deploy it",
    "as your own project.",
    "",
  )

  lines.push("## How this project is configured", "")
  lines.push("| | |")
  lines.push("|---|---|")
  lines.push(`| Deployment | ${isDocker ? "Docker Compose" : "Local Node"} |`)
  lines.push(`| Package manager | \`${pm}\` |`)
  lines.push(`| Database | ${describeDatabase(config)} |`)
  lines.push(`| Storage | ${describeStorage(config)} |`)
  lines.push(`| Redis | ${describeRedis(config)} |`)
  lines.push(`| Admin path | \`${config.adminPath}\` |`)
  lines.push("")
  lines.push(
    "All of it lives in `.env`, which was generated with real secrets and is",
    "ignored by git. Change anything there and restart; `create-flowcms` does not",
    "read it back. `.env.example` documents every variable, including the optional",
    "ones your `.env` leaves out.",
    "",
  )

  lines.push("## Running it", "")

  if (isDocker) {
    lines.push("```bash")
    lines.push(`${install}          # creates the lockfile the image build needs`)
    lines.push(`${composeUpCommand()}`)
    lines.push("```")
    lines.push("")
    lines.push(
      "The install is not optional before the first build: the image installs",
      `exactly what \`${lockfileFor(pm)}\` pins and cannot create one. If you scaffolded`,
      "with `--skip-install`, run it now.",
      "",
      "`.env` already names the Compose files and profiles this topology uses, so",
      "`docker compose up -d` needs no flags. Migrations run at container start.",
      "",
    )
  } else {
    lines.push("```bash")
    lines.push(`${install}`)
    lines.push(`${run("build:packages")}      # builds the local flowcms package`)
    lines.push(`${run("db:migrate")}          # applies database migrations`)
    lines.push(`${run("build")}`)
    lines.push(`${pm === "npm" ? "npm start" : run("start")}`)
    lines.push("```")
    lines.push("")
    lines.push(
      "For development, `" + run("dev") + "` instead of build and start.",
      "",
    )

    if (config.storage === "s3") {
      lines.push(
        "**Storage.** Uploads go to the S3-compatible endpoint you gave, via",
        "`STORAGE_DRIVER=s3`. If it is not reachable the site still starts and",
        "reports storage as not configured; uploads fail until it is.",
        "",
      )
    }

    if (config.storage === "local") {
      lines.push(
        "**Storage.** Uploads are files in `" + localStoragePathFor(config.deploymentMode) + "`,",
        "via `STORAGE_DRIVER=local`. Back that directory up alongside your database:",
        "it holds every uploaded image.",
        "",
        "This is **single-node**. A second FlowCMS instance does not share the",
        "directory unless you put it on a shared filesystem yourself; for multiple",
        "replicas use S3-compatible storage instead.",
        "",
      )
    }
  }

  lines.push("## The package manager, and the runtime", "")
  lines.push(
    `This project was created with \`${pm}\`, so \`${lockfileFor(pm)}\` is its lockfile`,
    "and every command in this file uses it. Do not mix managers: a second",
    "lockfile is a second answer to what is installed, and the Docker build reads",
    "only the one it was configured for.",
    "",
    "**The runtime is Node in every case.** FlowCMS runs on Node — the production",
    "image is `node:22-bookworm-slim`, and the application deliberately uses",
    "`@libsql/client` and `bcryptjs` rather than Bun-native APIs, which are not",
    "available inside Next-compiled server code. A package manager installs",
    "dependencies; it does not decide what serves the site.",
    "",
  )

  if (pm === "bun") {
    lines.push(
      "That applies to bun in particular: bun installs this project's",
      "dependencies, and the server still runs under Node. `bun run` honours the",
      "`#!/usr/bin/env node` shebang on the `next` binary, so the ordinary",
      "commands above start a Node process; `bun --bun run …`, which forces bun",
      "as the runtime, is not supported. The Dockerfile copies bun in to install",
      "and then builds a Node image.",
      "",
    )
  }

  lines.push("## First run", "")
  lines.push(
    "1. Start the site.",
    `2. Open **${config.baseUrl}/setup**.`,
    "3. It asks for a setup token. Yours is `FLOWCMS_SETUP_TOKEN` in `.env` —",
    "   open the file and copy the value. Do not put it in a URL.",
    "4. Create the first owner account and the site identity.",
    `5. Sign in at **${config.baseUrl}${config.adminPath}/login**.`,
    "",
    "Setup closes permanently once it completes: `/setup` returns 404 afterwards",
    "and the token stops doing anything. If you would rather not use the web form,",
    `\`${run("db:bootstrap-owner")}\` creates the first owner from a shell.`,
    "",
  )

  lines.push("## Commands", "")
  lines.push("| Command | What it does |")
  lines.push("| --- | --- |")
  lines.push(`| \`${run("dev")}\` | Development server |`)
  lines.push(`| \`${run("build:packages")}\` | Build the local \`flowcms\` package |`)
  lines.push(`| \`${run("build")}\` | Production build |`)
  lines.push(`| \`${pm === "npm" ? "npm start" : run("start")}\` | Serve the production build |`)
  lines.push(`| \`${run("lint")}\` | ESLint |`)
  lines.push(`| \`${run("typecheck")}\` | \`tsc --noEmit\` — run it after a build |`)
  lines.push(`| \`${run("db:migrate")}\` | Apply database migrations |`)
  lines.push(`| \`${run("db:bootstrap-owner")}\` | Create the first owner without the web form |`)
  lines.push("")

  lines.push("## The `packages/flowcms` directory", "")
  lines.push(
    "Your project carries a local copy of **`flowcms`**, the public FlowCMS theme",
    "API. Themes — including the default one — import from it as `flowcms/theme`,",
    `which is why \`${run("build:packages")}\` runs before the first build.`,
    "",
    "When FlowCMS is published to npm this becomes an ordinary versioned",
    "dependency and the directory goes away. Until then, carrying it is what makes",
    "your project independent rather than tied to a repository you do not have.",
    "",
  )

  lines.push("## Themes", "")
  lines.push(
    "`src/Themes/` holds all public presentation, and the default theme implements",
    "every surface. Writing your own — or installing one as a package — is",
    "documented in `docs/themes/authoring.md`. Installing a theme is three",
    "deliberate edits (dependency, registry entry, Tailwind `@source`); switching",
    "between themes you already have is a runtime setting in **Appearance**.",
    "",
  )

  lines.push("## Documentation", "")
  lines.push(
    "- `.env.example` — every configuration value, documented inline",
    "- `docs/setup/first-run.md` — first-run setup and what it does",
    "- `docs/docker.md` — the Docker topology, databases and storage",
    "- `docs/themes/authoring.md` — writing a theme",
    "",
    "Some of those were written for the FlowCMS project itself and refer to its own",
    "example fixtures. Those examples are not part of your project; the rules they",
    "describe are.",
    "",
  )

  return lines.join("\n")
}

/**
 * The lockfile the README names, from the SAME table the Dockerfile is rendered
 * from.
 *
 * It used to be a second copy of that table here. Two tables is how a README
 * tells an operator to create `bun.lockb` while the image build tests for
 * `bun.lock` — a contradiction between two generated files that only appears
 * once the build fails.
 */
function lockfileFor(manager) {
  return LOCKFILES[manager]
}
