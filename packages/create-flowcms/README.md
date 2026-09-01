# create-flowcms

Creates a new [FlowCMS](https://github.com/) site: a complete, standalone
application in a directory of your choosing.

```
npx create-flowcms@latest my-site
```

That copies the FlowCMS application into `my-site/`, gives it its own package
metadata and installs its dependencies. What comes out is **your project**:
nothing in it points back at the FlowCMS repository, and you commit it, change
it and deploy it as your own.

## Usage

Run it with no options and it asks:

```
create-flowcms my-site
```

Or answer everything up front, which is what CI does:

```
create-flowcms my-site \
  --deployment docker \
  --database postgresql \
  --storage garage \
  --redis none \
  --admin-path /control \
  --package-manager pnpm
```

```
  --deployment <docker|local>                    default: docker
  --database <sqlite|postgresql|mysql|mariadb>   default: sqlite
  --storage <garage|s3>                          default: garage (docker), s3 (local)
  --redis <none|bundled|external>                default: none
  --admin-path <path>                            default: /admin
  --base-url <url>                               default: http://localhost:3000
  --package-manager <npm|pnpm|yarn|bun>          default: npm
  --skip-install
  -h, --help
  -v, --version
```

**Anything not supplied is asked for in a terminal, and is an error without
one.** Nothing about your infrastructure is guessed.

The destination must not exist, or must be an empty directory. A directory with
files in it is refused before anything is written — `create-flowcms` will not
merge into an existing project.

## What it configures

A database, object storage, optional Redis, where the admin panel lives, and
whether the project runs under Docker Compose or as a Node process you start
yourself. It writes a `.env` with generated secrets, selects the Compose
topology, renders the Dockerfile for your package manager, and writes a README
describing what you actually chose.

Storage comes in two shapes. `local` keeps uploads as files in a directory,
which suits a single node and needs no account anywhere. `s3` keeps them in any
S3-compatible bucket — and in Docker the bundled Garage provides one, still
without an account anywhere. Garage is infrastructure rather than a third
option: it runs `STORAGE_DRIVER=s3`, exactly like a hosted provider.

### Secrets

`AUTH_SECRET`, `CAPTCHA_SECRET`, `FLOWCMS_SETUP_TOKEN`, `PREVIEW_SECRET` and any
managed database or Garage credentials are generated for you — independently,
from `crypto.randomBytes` — and written to `.env`. None of them is ever printed.

**No flag carries a secret**, and none will: a secret in a flag is a secret in
your shell history. If you use external S3 or Redis, the installer asks without
echoing, or reads `FLOWCMS_INSTALL_*` environment variables for automation.

## What it does not do

It configures a deployment. It does not initialise the CMS.

No owner account, no site name, no content, no theme selection. After
scaffolding you start the site, open `/setup`, and use the
`FLOWCMS_SETUP_TOKEN` from your `.env` to create the first owner.

No telemetry, no update check, no network access beyond the dependency install
you asked for, and no code runs on `npm install` — only when you invoke the
command. The application template ships inside this package.

## `--skip-install` and Docker

`--skip-install` creates the project without installing dependencies, for CI and
offline use.

If you are deploying with Docker, note that the image build runs a **frozen**
install — it installs exactly what your lockfile pins and cannot create one. So
run the install before the first `docker compose up`. The generated README and
the CLI's closing instructions both say so.

## Verification status

The scaffolding and packaging path was verified end to end in the previous
release **with npm, on Windows**.

| | Level | |
|---|---|---|
| npm | **Verified** | install, build, typecheck, lint and Docker from a generated project |
| pnpm, bun | **Supported** | implemented and unit-tested, no known blocking defect, not run end to end |
| yarn | **Experimental** | the same, plus two unresolved risks — Berry's Plug'n'Play leaves no `node_modules` for the build script's literal path, and yarn 1 copies a `file:` dependency at install time |

macOS and Linux have not been run. The deployment configuration — the four
databases, Garage and external S3, Redis and custom admin paths — is implemented
and unit-tested, and only npm's path has been driven end to end.

Support levels, the per-manager risks and the cross-platform notes are in
`docs/distribution/package-managers.md` in the FlowCMS repository.

## Invoking it

Every package manager's create shorthand works:

```
npx create-flowcms@latest my-site
npm create flowcms@latest my-site -- --database sqlite
pnpm create flowcms my-site
yarn create flowcms my-site
bun create flowcms my-site
```

npm parses its own flags before the package's, so options for this CLI go after
`--`. The four managers disagree about whether they eat that separator or
forward it, so a bare `--` is accepted and ignored either way.

**The runtime is Node whichever manager you choose.** Selecting bun selects a
package manager; the production image is `node:22-bookworm-slim` and the
application uses `@libsql/client` and `bcryptjs` rather than Bun-native APIs,
which are unavailable inside Next-compiled server code.

## Status

Published on npm and licensed `GPL-2.0-or-later`. The current release is
**0.2.0**.

It still carries a `prepublishOnly` guard, and that is permanent rather than
left over: it refuses unless `FLOWCMS_RELEASE=1`, which only the publish job in
the repository's release workflow sets. A `npm publish` run by hand, from a
laptop, with no release in progress still fails — while a real release passes
every one of the guard's checks on the way through.
