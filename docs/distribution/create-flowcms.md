# create-flowcms

The scaffolder that creates a new FlowCMS site.

> **Not published.** `create-flowcms` exists in this repository
> (`packages/create-flowcms`) and is not on npm: `npx create-flowcms` does not
> resolve, and neither does `npm create flowcms`, `pnpm create flowcms`,
> `yarn create flowcms` or `bun create flowcms`. See
> [Project status](../../README.md#project-status).
>
> **On "verified".** The end-to-end proof — pack, install outside the
> repository, scaffold, install, build — runs in CI and passes: the scaffolder
> is exercised for all four package managers, and the generated project is built
> and imaged. See
> [package-managers.md](./package-managers.md#package-managers) for what each
> manager's evidence covers.

## What it is

`create-flowcms` copies the FlowCMS **application** into a new directory, gives
it its own package metadata, and installs its dependencies. What comes out is a
standalone project: it does not reference this repository, does not link back
into it, and does not need it to build.

It is a scaffolder, not a library installer. FlowCMS is an application; the
`flowcms` package is its public *theme API* and nothing more. A project made by
running `npm init` and adding `flowcms` as a dependency would not be a CMS, and
`create-flowcms` does not pretend otherwise.

```
packages/create-flowcms/
  bin/create-flowcms.mjs     the executable
  src/*.mjs                  arg parsing, destination safety, copy, package managers
  src/config/*.mjs           the deployment model, validation and secrets
  src/prompts/interactive.mjs  the TTY installer
  src/render/*.mjs           .env, Compose selection, Dockerfile, README, marker
  template/                  the application, built from this repository
  template.json              which FlowCMS version the template is
```

Plain ESM, **no dependencies**, Node `>=22` — interactive installer included.
Argument parsing is a table and forty lines;
the prompts are `node:readline` and about a hundred, masked input included. A
library for either would be a version to track and a supply chain to trust,
bought for a select list.

## The CLI

```
create-flowcms <project-directory> [options]

  --deployment <docker|local>
  --database <sqlite|postgresql|mysql|mariadb>
  --storage <garage|s3>
  --redis <none|bundled|external>
  --admin-path <path>
  --base-url <url>
  --package-manager <npm|pnpm|yarn|bun>
  --skip-install
  -h, --help
  -v, --version
```

**Anything not supplied is asked for in a terminal, and is an error without
one.** The installer never guesses at infrastructure: a run that could not ask
and was not told fails naming the flag, rather than quietly choosing somebody's
database for them.

A command with every flag supplied behaves identically with or without a TTY,
which is what makes it usable from CI and from a future automated installer.

### There is no flag that carries a secret

No `--auth-secret`, no `--db-password`, no `--s3-secret-key`, and there will not
be. A secret in a flag is a secret in shell history, in `ps` output and in a CI
log.

Generated secrets are generated internally. External credentials — an S3 secret
key, a Redis URL, a database URL — come from a **masked prompt**, or from
installer-namespaced environment variables:

| | |
|---|---|
| `FLOWCMS_INSTALL_S3_ENDPOINT` | and `_REGION`, `_BUCKET`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` |
| `FLOWCMS_INSTALL_DATABASE_URL` | an external database |
| `FLOWCMS_INSTALL_REDIS_URL` | an external Redis |

The namespace is deliberately **not** the application's own variable names. If
the installer read `S3_SECRET_ACCESS_KEY`, a machine that already had FlowCMS's
runtime environment loaded would silently configure a new project with the old
installation's credentials — inherited by accident, and correct-looking.

The five S3 values are all-or-nothing: a partially configured endpoint is worse
than an unconfigured one, because it looks configured.

## What it configures

### Database

One of four, and the application keeps support code for all of them — the
installer configures a database, it does not remove the others.

| | Docker | Local |
|---|---|---|
| SQLite | `file:/data/app.db` on a named volume | `file:data/app.db` in the project |
| PostgreSQL | managed `postgres:17` service, generated password | your `DATABASE_URL` |
| MySQL | managed `mysql:8.4` service, generated password and root password | your `DATABASE_URL` |
| MariaDB | managed `mariadb:11.4` service, generated password and root password | your `DATABASE_URL` |

`DATABASE_DIALECT` is **always written explicitly** and never inferred from the
URL — MariaDB and MySQL share the `mysql://` scheme, so inference would run one
engine's SQL against the other. MariaDB is its own choice in the UI for the same
reason: it is a different image taking differently-named variables.

Managed passwords are generated with `randomBytes(32)`. The user and database
name are `flowcms`, which is readable and is not a secret; the password is not
`flowcms`, `password`, `changeme` or `root`.

Exactly one URL is written, and it is the operator's actual choice. Alternatives
live in `.env.example`; a generated `.env` carrying three commented-out URLs is
a file where the authoritative one is a guess.

### Storage

`garage` or `s3`. **There is no third option and no local-filesystem media
backend** — FlowCMS serves images from object storage through
`/api/public/images`, so an uploads-directory choice would configure something
the application does not implement.

Garage is **infrastructure, not a mode**. The application talks to
`StorageService`, which talks S3, and cannot tell Garage from AWS. Nothing
branches on vendor, which is why moving off Garage is five environment values.

Garage is a Compose service, so it is not available to a local deployment; the
installer refuses that combination rather than writing a configuration that
cannot work.

### Redis

`none`, `bundled` (the existing Compose profile) or `external`. Optional and
staying optional: without it the login rate limiter falls back to a per-process
implementation that still limits, just not across replicas.

Disabled writes **nothing** — not `REDIS_URL=`. Empty and absent mean the same
thing to the application, and an empty assignment reads like a setting somebody
cleared.

### Admin path

Validated by the same rules the application uses, including the reserved-segment
list — so `/admin-panel`, `/api`, `/blog` and the rest are refused, and the
internal route can never be written into `FLOWCMS_ADMIN_PATH`.

The CLI carries a port of `validateAdminPath` rather than importing it: a
published CLI cannot reach `src/`, and exporting it from `flowcms` would widen a
public API no theme author needs. `tests/scaffolder/adminPathParity.test.ts`
drives both implementations over one table, the same way secret generation is
kept in parity.

### Deployment mode

`docker` or `local`. Nothing else: Kubernetes, serverless and PaaS modes would
be platforms nobody has tested.

**Local mode still uses S3.** It configures a Node process outside Docker; it
does not mean SQLite plus local uploads. Garage is Docker infrastructure, so a
local deployment points at an external S3-compatible endpoint or at a Garage the
operator runs themselves.

Hostnames belong to a context and are never mixed. Docker mode writes
`postgres:5432` and `http://garage:3900`; local mode writes `localhost` and the
endpoint you gave.

## Compose topology

The installer writes the selection into `.env` rather than generating YAML:

```
COMPOSE_PATH_SEPARATOR=:
COMPOSE_FILE=compose.yml:compose.postgres.yml
COMPOSE_PROFILES=redis
```

and **deletes the overlays it did not choose**. The operator types
`docker compose up -d` — no flags — and gets exactly one database, Garage only if
selected, Redis only if selected.

The repository's overlays are already clean and already express every topology;
regenerating that YAML in an installer would duplicate substantial logic certain
to drift from the files it was copied from. `COMPOSE_PATH_SEPARATOR` is pinned
because Compose's default differs by platform and this file is committed.

A local-mode project keeps no Compose files at all — shipping one would suggest
`docker compose up` is supported when the `.env` was written for localhost.

## Package managers and Docker

The selected manager decides the lockfile, the install command, and the
Dockerfile's install step. **One Dockerfile**, with a rendered region:

```dockerfile
# flowcms:render:package-manager
…the selected manager's lines…
# flowcms:render:end
```

Four near-identical Dockerfiles would drift the first time anything else in the
build changed. Nothing operator-controlled is interpolated: the manager is an
enum member and the text comes from a table.

| Manager | Lockfile | Image install |
|---|---|---|
| npm | `package-lock.json` | `npm ci --ignore-scripts` |
| pnpm | `pnpm-lock.yaml` | `corepack enable && pnpm install --frozen-lockfile --ignore-scripts` |
| yarn | `yarn.lock` | `corepack enable && yarn install --immutable` (v2+) or `--frozen-lockfile` (v1) |
| bun | `bun.lock` | bun copied from `oven/bun:1`, then `bun install --frozen-lockfile` |

Corepack ships with Node 22 but is **not enabled by default**, so pnpm and yarn
enable it explicitly. Yarn's flag depends on its major version, which the
installer observes from `yarn --version` rather than assuming.

**The runtime stays Node in every case.** Choosing bun installs dependencies
with bun; it does not run the server with bun, and that is a fixed architecture
decision.

**Nothing outside that region assumes a manager either.** Two things used to,
and both were npm-shaped defects only a non-npm project could hit: the builder
stage ran `npm run build` in a stage where `corepack enable` had not survived
and bun was not present, and `scripts/collect-db-drivers.mjs` read
`package-lock.json` by name — so a pnpm, yarn or bun image build died with
`ENOENT` naming a lockfile the operator never chose. The build is now invoked
through node, and the driver closure is computed from `node_modules`, which all
four produce. Support levels, known per-manager risks, and the invocation
caveats for `npm create` / `yarn create` / `bun create` are in
[package-managers.md](./package-managers.md).

### The lockfile, and `--skip-install`

No lockfile ships. The selected manager writes its own during install, and the
image build installs exactly what that lockfile pins.

So `--skip-install` plus Docker means **no lockfile yet**, and the build cannot
create one. That is made explicit in three places:
the rendered Dockerfile fails with a sentence naming the command that was
skipped, the final instructions mark the install as required before the build,
and the generated README says the same.

### `packageManager`

Written **only when the version was observed**, and **only for a manager
corepack manages**. Corepack reads the field and refuses to run a version that
does not exist, so an invented one turns every command in the project into an
error. No version, no field — omission is honest, a wrong value is not.

Corepack manages three package managers, and it does not ignore a fourth it does
not know: a manifest saying `bun@1.3.14` makes every corepack shim in that
project fail with `Unsupported package manager "bun"` — which is npm, pnpm and
yarn on any machine where `corepack enable` was ever run for something else. Bun
does not read the field, so writing it bought nothing and cost that. The choice
is still recorded, in `.flowcms/project.json`.

## Secrets

Four, each an independent `randomBytes(32)`:

| | |
|---|---|
| `AUTH_SECRET` | signs every session; a weak one fails open and silent |
| `CAPTCHA_SECRET` | signs the login CAPTCHA; absent means nobody can sign in |
| `FLOWCMS_SETUP_TOKEN` | gates `/setup`; absent LOCKS it rather than opening it |
| `PREVIEW_SECRET` | signs draft links; the installer can generate a strong one for free |

Plus managed database and Garage credentials where the installer is the one
creating the service. Independence is asserted by validation: one value reused
would be a single key unlocking sessions, the CAPTCHA, setup and previews at
once.

**Nothing prints a secret.** The summary says "Generated". The final
instructions name `FLOWCMS_SETUP_TOKEN` and say to open `.env` — a terminal
scrolls into a screenshot, a screen share and a support ticket, and a token
pasted into one has to be rotated. A setup token is never put in a URL.

The summary is built from a **whitelist** of non-sensitive fields, so a secret
added to the configuration later is invisible by default rather than needing
somebody to remember to redact it.

## The generated `.env`

Written by a serializer, not by string concatenation. Values needing quotes get
them; values containing a **newline or control character are refused**, because
a newline in a dotenv value is a second line and a second line is a variable
nobody wrote. Error messages name the key and never the value.

`chmod 0600` on POSIX, best-effort elsewhere — failing project creation over a
permission bit on Windows would trade a real outcome for a cosmetic one.
`.gitignore` already excludes `.env` while keeping `.env.example`.

## What it still does not do

No owner, no site identity, no content, no theme selection. The boundary is
unchanged:

```
create-flowcms  →  deployment configuration
/setup          →  first owner + site identity
Admin           →  everything after that
```

No connectivity is probed — not the database, not S3, not Redis. Readiness and
setup already own that question, and a second implementation would be a second
answer. No migrations run during scaffolding; Docker runs them at container
start.

No `--reconfigure`: changing deployment configuration after creation is editing
`.env` and restarting.

Unknown flags are **refused**, not ignored. A scaffolder that accepts
`--skipinstall` runs an install the operator declined, with no symptom but a
wait; the same rule catches a misspelling of any deployment flag.

| Exit | Meaning |
|---|---|
| `0` | scaffolded (installed, or skipped on request) |
| `1` | dependency installation failed, or an unexpected error |
| `2` | usage error — bad flag, bad destination, missing argument |
| `130` | interrupted |

## The application template

**Built from this repository, never hand-maintained.**
`scripts/build-create-flowcms.mjs` renders `packages/create-flowcms/template/`
from an explicit manifest, `scripts/lib/templateManifest.mjs`. The template
directory is generated output and is gitignored.

A hand-kept copy of an application is wrong within a month, and wrong in the way
nobody notices: the repository gains a route, a migration, a dependency, and
generated projects quietly keep shipping last month's. Building it means the
manifest is the only thing to keep honest — and a manifest is short enough to
read.

The manifest is an **allowlist**. That is the difference that matters: an ignore
list ships everything nobody thought to exclude, and this repository contains a
developer's `.env`, a SQLite database, a credentials scratch file, agent tooling
and several thousand lines of internal planning. Every one would have to be
*remembered*. With an allowlist, a new directory is absent by default.

The build fails when a manifest entry names something that no longer exists, so
a moved directory is a build error rather than a project missing a feature.

### What a generated project contains

The whole application: `src/`, `public/`, `scripts/`, `docker/`, the Dockerfile
and every Compose overlay, `tsconfig.json`, `tsconfig.package.json`,
`next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`,
`components.json`, `.env.example`, `.dockerignore`, an ignore file, a generated
`README.md`, operator documentation, and `packages/flowcms`.

**`next-env.d.ts` is deliberately absent from the manifest.** Next generates it,
Next's own shipped documentation says twice not to track it, and the copy in
this repository imports `./.next/types/routes.d.ts` — build output. A manifest
entry for it would fail the template build on every fresh clone. The two ambient
references it carries live in **`src/next-globals.d.ts`** instead, which is
tracked and ships with `src/` without needing an entry of its own; Next
prescribes exactly this (a separate `.d.ts` rather than editing the generated
one). A generated project's first `next dev` or `next build` writes its own
`next-env.d.ts`, and the two coexist — TypeScript resolves each reference once.

All four database dialects, both storage paths, the admin-path indirection and
the first-run setup domain are present and untouched. The scaffolder chooses
nothing, so it may delete nothing.

### What it does not contain, and why

| Excluded | Why |
|---|---|
| `packages/flowcms-theme-aurora` | an integration fixture; an operator's Appearance screen must not list a test theme |
| `src/Themes/integration` | the same, in-tree |
| `tests/`, `vitest.config.ts` | the suite asserts against this repository's own fixtures and packaging |
| `src/db/seed.ts` | development sample data, and Bun-only |
| `public/assets/tinymce` | 9.8 MB, gitignored, regenerated by `postinstall` |
| `drizzle.config.*.ts` | authoring migrations is FlowCMS development, not site operation |
| `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` | they describe developing FlowCMS, not running a site |
| maintainer-only documentation, `docs/distribution/` | internal planning and release documents |
| `.git/`, local tooling directories, `.env`, `data/`, credentials files, `*.db`, tarballs | never, under any circumstances |

Shipped documentation is `docs/docker.md`, `docs/setup/first-run.md` and
`docs/themes/authoring.md` — operator- and theme-author-facing.

### Removing the fixtures: `flowcms:template-strip`

The theme registry is static by design, so a fixture cannot simply be left out
of a copy: the import that names it would dangle. Four files carry sentinel
comments around their fixture-only blocks, and the builder deletes them:

```ts
// flowcms:template-strip:start — the example theme is a repository fixture
import auroraTheme from "@example/flowcms-theme-aurora"
// flowcms:template-strip:end
```

| File | What is stripped |
|---|---|
| `src/Themes/packages.ts` | the example theme's import, registry entry and screenshot helper |
| `src/Themes/registry.ts` | the integration theme's import and entry |
| `src/app/globals.css` | the Tailwind `@source` line for the example theme |
| `Dockerfile` | its manifest `COPY` and its build step |

Two properties make this safe rather than clever. **A strip that matches nothing
fails the build**, so a renamed sentinel is caught immediately. And **each block
is arranged so removing it leaves compiling code** — `packageThemes()` keeps a
trailing `return []`, and the example-theme build is its own `RUN` line rather
than half of an `&&` chain.

`src/Themes/packages.ts` keeps its instructions: a generated project's copy
still explains how to install a theme, with the fixture gone.

## The generated project

### `package.json`

Parsed and re-serialised — never text-replaced, because a regex over a manifest
is how a project named `next` gets its dependency renamed along with it.

Changed: `name` (derived from the directory), `version` (`0.1.0` — the
project's own, unrelated to the FlowCMS release), `private: true`.

Removed: `test`, `test:watch`, `db:seed`, `build:example-theme`,
`build:template`, and **all six dialect-specific Drizzle scripts** —
`db:generate:{sqlite,postgresql,mysql}` and `db:studio:{sqlite,postgresql,mysql}`.
There is one command per dialect because there is one Drizzle config per dialect
(MariaDB shares the MySQL track), none of the configs is shipped, and
`tests/scaffolder/template.test.ts` fails if a `drizzle.config.*` ever reaches a
generated project — so every script naming one has to go with them. Authoring
migrations is FlowCMS development, not site operation.

Also removed: the `@example/flowcms-theme-aurora`, `vitest` and `drizzle-kit`
devDependencies. `build:packages` becomes `node scripts/build-package.mjs`.

The authoritative lists are `DROPPED_SCRIPTS`, `DROPPED_DEV_DEPENDENCIES` and
`REWRITTEN_SCRIPTS` in `scripts/lib/templateManifest.mjs`.
`tests/scaffolder/rootScripts.test.ts` fails if a root script names an excluded
path without being dropped or rewritten, which is the pairing this table used to
record by hand.

Everything else is the template's. Every remaining script is checked by
`tests/scaffolder/template.test.ts` to name a file the template actually
contains — the classic scaffolder defect being a manifest full of commands
pointing at files the template left behind.

### Project name

Derived from the destination's basename: lowercased, unsupported characters
collapsed to a hyphen. `My Site` becomes `my-site`.

Normalisation is narrow on purpose. A name it would have to *invent* — `🚀`,
`---` — is refused rather than mangled, and `flowcms` is refused with its
reason: the project would share a name with the package it depends on, and npm
refuses to install a package under a package of the same name — which is why the
repository root is not called `flowcms`.

### `packages/flowcms`, before publication

The generated project carries its **own copy** of the public theme API and
depends on it as `"flowcms": "file:packages/flowcms"`. `flowcms` is not on npm,
so a generated project cannot depend on a registry version — and must not depend
on a path back into this repository.

`npm run build:packages` therefore builds the project's own copy, and
`flowcms/theme` resolves through the project's `node_modules` with **no tsconfig
alias**.

**For v0.1 this vendored arrangement is the decision of record, not a stopgap.**
A generated project resolves `flowcms` from the copy inside itself, compiled
from its own `src/Themes/contract`, and the published `flowcms` package exists
for **theme authors** writing a standalone theme package against
`flowcms/theme`. The two versions cannot drift, because they are one constant
compiled twice from one source file. **No document may say that a generated
project consumes the published package.**

And the switch, when it is made, is **not a one-line change.** It touches six
files, including a manifest rewrite mechanism that does not exist today — and
the file count is not
the worst of it: a project that consumed the registry package would carry
`src/Themes/contract` **and** a registry copy, so a floating range could resolve
a `FLOWCMS_VERSION` different from the one a theme compiled against, silently
and intermittently. That is a v0.2 change with its own verification. Nothing in
the template assumes a registry package that does not exist.

### No lockfile

This repository's lockfile names `flowcms-app` and the Aurora devDependency; it
is wrong for every generated project. The selected package manager writes its
own during install.

**Consequence, stated rather than hidden:** the generated `Dockerfile` runs a
frozen install, which needs the selected manager's lockfile. The supported order
is therefore **scaffold → install → docker build**. With `--skip-install` the
Docker path waits until the operator installs, and the rendered Dockerfile fails
with a sentence naming the command that was skipped rather than with buildkit's
"not found".

The `packageManager` field is written when the manager is corepack-managed and
its version was observed — see [`packageManager`](#packagemanager) above. Phase
7.3 omitted it entirely because the manager had not been chosen yet.

### `.flowcms/project.json`

```json
{ "templateVersion": "0.1.0", "createdWith": "create-flowcms@0.1.0" }
```

For future migration tooling: an upgrade path from one template version to the
next has to know which one it is looking at, and asking the operator is not an
answer. No secrets, no paths, no machine identity, and no timestamp — a creation
time is not something any tool here would act on, and it makes two identical
scaffolds differ.

## Safety

**Destination.** Must not exist, or exist and be empty. A non-empty directory is
refused *before anything is written*; `.DS_Store` does not count as content and a
`.git` directory does. Symlinks, files, the filesystem root and a missing parent
are each refused with their own message. Merging into an existing project is a
real feature with real questions, and guessing at it would eventually delete
work somebody cared about.

**Cleanup ownership.** If the copy fails, a directory *this process created* is
removed; a directory the operator created and handed over is emptied but kept.
The distinction is the point: deleting the second destroys something we were
given rather than something we made.

**Install failure never deletes.** Once the project is valid it stays, and the
CLI prints the command to finish it.

**No shell, ever.** Every child process is `spawn(command, argsArray, { cwd })`.
The destination is passed as an option, not concatenated into a command, so a
path containing spaces, `;`, `&` or `$(…)` is an ordinary path. Tested with all
four.

**Traversal.** Every template entry is checked to resolve inside the
destination. The template is first-party and this cannot fire today, which is
why it is three lines — the day it *can* fire, the consequence is writing
outside the directory the operator named.

**Binary safety.** Everything is copied byte-for-byte. The only rendering is
`package.json` (as parsed JSON), the ignore-file rename, and two written files.
Reading a PNG as UTF-8 to run a replacement through it corrupts it in a way no
test that does not open the file would catch.

**Symlinks.** The template build *refuses* to copy one rather than following it,
and the artifact proof asserts the generated project contains none.

## Package managers

Levels, per-manager risks, invocation caveats and the cross-platform notes live
in [package-managers.md](./package-managers.md). In short:

| | Level |
|---|---|
| **npm** | **Verified** — install, build, typecheck, lint and Docker from a generated project, on Windows |
| pnpm, bun | **Supported** — implemented and unit-tested, no known blocking defect, **not run end to end** |
| yarn | **Experimental** — the same, plus two unresolved risks: Berry's Plug'n'Play leaves no `node_modules` for the `build` script's literal path, and yarn 1 copies a `file:` dependency at install time, which is how the local `flowcms` package would be snapshotted before it is built |

There is no auto-detection. npx sets `npm_config_user_agent` even when the
operator's own project uses pnpm, so "detection" would confidently pick the
wrong one; the default is npm and it is stated rather than guessed.

If the requested manager is missing, the CLI fails *before scaffolding* and says
so. It never silently falls back to another — that would produce a lockfile the
operator did not want and would not notice until it was committed.

## Secret generation

`generateDeploymentSecret()` — `randomBytes(32).toString("base64url")`, 256
bits, in `packages/create-flowcms/src/secrets.mjs`. The
deployment-configuration path calls it for `AUTH_SECRET`, `CAPTCHA_SECRET`,
`PREVIEW_SECRET` and `FLOWCMS_SETUP_TOKEN`, and writes them **to the generated
`.env` only**. **No secret is printed to the terminal, passed as a flag, or sent
anywhere.**

The CLI is a standalone package and cannot import `@/Framework/…`, and
restating the entropy policy inside it is the one thing that must not happen:
two copies drift, and the drift shows up as an installer writing a secret the
application then refuses, in someone else's deployment. So neither side knows
about the other, and `tests/scaffolder/secretGeneration.test.ts` is where they
meet — 200 generated values through the real `classifyDeploymentSecret` and the
real `classifyAuthSecret`.

## No telemetry, no network

`create-flowcms` makes no network request of its own: no analytics, no update
check, no template fetched from a URL. The template ships inside the package,
which is what makes project creation reproducible. The only network activity is
the dependency install the operator asked for, and `--skip-install` removes even
that.

There is no `postinstall` on the package either: installing `create-flowcms`
runs no code, and scaffolding happens only when the bin is invoked.

## Verifying

```bash
node scripts/build-create-flowcms.mjs        # build the template
npm test                                      # builds it first, then the suite
node scripts/verify-create-flowcms.mjs        # the full proof
node scripts/verify-create-flowcms.mjs --no-docker
```

The proof packs the CLI, **copies the tarball to a directory unrelated to this
repository**, installs it there, runs the installed bin, generates a project
outside the repository, and then installs, builds the local package, builds,
typechecks, lints and `docker build`s it — asserting along the way that nothing
is a symlink, no file mentions this repository's path, and `flowcms/theme`
resolves under the project's own `node_modules`.

Running the CLI from the repository would prove only that it works where every
file it could want is already on disk. It could not catch a `files` allowlist
that forgot the template, a path resolved from `process.cwd()`, a `.gitignore`
npm renamed on the way in, or a generated project that builds only because the
repository's `node_modules` is one directory up. Each of those works perfectly
here and fails for the first stranger.

## What the installer configures, end to end

`create-flowcms` collects the database engine and its URL
(with an explicit `DATABASE_DIALECT`, never inferred), Garage versus an external
S3 endpoint and its credentials, Redis, `FLOWCMS_ADMIN_PATH` (validated by a port
of `validateAdminPath` with a parity test against the application's copy), the
deployment mode and the package manager. It generates four independent
deployment secrets plus any managed-service credentials, writes them to a `.env`
through a serialiser that refuses newline injection (`0600` where the platform
enforces it, best-effort on Windows), selects the Compose topology through
`COMPOSE_FILE`/`COMPOSE_PROFILES` while deleting unselected overlays, renders the
Dockerfile's package-manager region, and writes a configuration-specific README.

**A generated project's `.env` is not written by hand.**

**Theme selection is deliberately not offered**, and is not planned for v0.1:
`activeTheme` stays null, which already means the default theme.

**What the installer deliberately does not do:** it creates no owner account, no
site content and no database rows, and it does not mark an installation
initialized. `/setup` owns that — see `docs/setup/first-run.md`. It also probes
no connectivity and runs no migrations.
