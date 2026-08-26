# FlowCMS

A self-hosted content management system built on Next.js — a public site plus an
admin panel, a blog, custom pages, media management, first-class SEO tooling,
and a theme system for everything the visitor sees.

> **Status: pre-release.** FlowCMS is licensed **GPL-2.0-or-later** (see
> [`LICENSE`](LICENSE)). Nothing has been published yet: the `flowcms` and
> `create-flowcms` npm packages, the first release tag and the first GitHub
> release are all still to come. Everything below runs from a checkout or a
> locally packed tarball. See [Project status](#project-status).

## What it does

- **Blog** — posts with drafts, scheduling, an editorial review workflow,
  revision history with restore, concurrent-edit locking, categories, tags,
  series, FAQ blocks, and moderated reader questions.
- **Custom pages** — arbitrary public URLs rendered from the CMS.
- **Themes** — everything public is rendered by a theme under `src/Themes/`.
  Themes are *installed* at build time (an explicit import in a registry) and
  *activated* at runtime (a setting an admin changes without a rebuild). A theme
  can live in the repository or arrive as an npm package.
- **Media** — an S3-backed file manager with folders, and a rich-text editor
  that inserts images from the same bucket.
- **SEO** — meta templates, JSON-LD, sitemaps (chunked), RSS, a news sitemap,
  redirect management with CSV import, a 404 log, broken-link scanning,
  internal-link suggestions, and a site-wide SEO audit.
- **Integrations** — Google Search Console, Bing Webmaster Tools, PageSpeed
  Insights, IndexNow. All optional, and all degrade to a "not connected" state
  rather than failing when unconfigured.
- **Staff accounts** — four roles (`owner`, `admin`, `editor`, `contributor`)
  enforced on every API route, plus an append-only activity log.

## Run it with Docker

The fastest way to a working install. Brings up FlowCMS with a persistent
SQLite volume and a bundled [Garage](https://garagehq.deuxfleurs.fr/)
S3-compatible object store, so uploads work immediately.

```bash
cp .env.example .env
# Generate the secrets it asks for:
#   openssl rand -base64 32     # AUTH_SECRET
#   openssl rand -base64 32     # CAPTCHA_SECRET
#   openssl rand -hex 16        # GARAGE_ACCESS_KEY_ID
#   openssl rand -base64 32     # GARAGE_SECRET_ACCESS_KEY
#   openssl rand -base64 32     # FLOWCMS_SETUP_TOKEN (only for browser setup)

docker compose up -d
curl -s localhost:3000/api/ready
```

The admin panel is at `http://localhost:3000/admin`, and moves anywhere you like
without rebuilding the image:

```bash
FLOWCMS_ADMIN_PATH=/secure-console docker compose up -d
```

Then create the first owner. **Nothing creates one for you, and there is no
default account.** Either open the site — it redirects to `/setup` while the
installation is uninitialized, and asks for the setup token — or bootstrap from
a shell, which needs no token because shell access already is the authorization:

```bash
docker compose run --rm \
  -e FLOWCMS_OWNER_EMAIL=you@example.com \
  -e FLOWCMS_OWNER_PASSWORD='choose-a-long-unique-password' \
  -e FLOWCMS_OWNER_NAME='Your Name' \
  --entrypoint node app scripts/bootstrap-owner.mjs
```

Both paths create exactly one owner and close setup permanently. See
**[docs/setup/first-run.md](docs/setup/first-run.md)** for what that marker is,
and why deleting every user afterwards does not reopen setup.

### Databases

The default is SQLite, which needs no database server. FlowCMS also supports
**PostgreSQL 17**, **MySQL 8.4** and **MariaDB 11.4** — the image is identical
for all four, and the database is chosen at runtime by `DATABASE_DIALECT` and
`DATABASE_URL`:

```bash
docker compose -f compose.yml -f compose.postgres.yml up -d
docker compose -f compose.yml -f compose.mysql.yml   up -d
docker compose -f compose.yml -f compose.mariadb.yml up -d
```

Redis is opt-in (`--profile redis`), and an external S3 provider can replace
Garage entirely (`-f compose.external-s3.yml`) — storage and cache are
independent of the database. Migrations run automatically at container start.

See **[docs/docker.md](docs/docker.md)** for every database mode, persistence,
backups, health and readiness semantics, and the full environment reference.

## Requirements

Running from a checkout rather than Docker:

- **Node.js 22+**. This is the primary supported runtime and what the Docker
  image runs. **Bun 1.2+** also works for local development.
- An **S3-compatible** object store. Any of AWS S3, Cloudflare R2,
  [Garage](https://garagehq.deuxfleurs.fr/), Wasabi, Backblaze B2, or
  DigitalOcean Spaces. Garage is bundled in the Docker Compose setup.
- **Redis** — optional, but recommended. It backs the admin cache and
  cross-instance login rate limiting.

## Getting started from a checkout

```bash
npm install                # or: bun install

cp .env.example .env.local
# Fill in AUTH_SECRET and CAPTCHA_SECRET at minimum. Generate each with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

npm run db:migrate         # create the database (SQLite by default)
npm run dev
```

Then create the first owner, exactly as under Docker — open the site and follow
`/setup` (which needs `FLOWCMS_SETUP_TOKEN` in your `.env.local`), or run:

```bash
FLOWCMS_OWNER_EMAIL=you@example.com \
FLOWCMS_OWNER_PASSWORD=a-long-random-password \
  node scripts/bootstrap-owner.mjs
```

`npm run db:seed` is **development sample data**, is Bun-only, and is not how an
installation is initialized.

The admin panel is at **`/admin`**. `/admin-panel` is an internal implementation
detail and always returns 404 to a browser. Published content renders at `/blog`
and at any custom-page path you create; `/` is a deliberate placeholder page in
the default theme.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server, bound to `0.0.0.0` |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (flat config; `next lint` is removed in Next 16) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest, once |
| `npm run test:watch` | Vitest, watching |
| `npm run db:migrate` | Apply migrations for the configured dialect |
| `npm run db:bootstrap-owner` | Create the first owner account from a shell |
| `npm run db:seed` | Development sample data (Bun-only) |
| `npm run build:packages` | Build the published `flowcms` package and the example theme |
| `npm run build:template` | Build the `create-flowcms` application template |

`npm run test` builds the packages and the template first, because part of the
suite reads the built artifacts rather than the source they came from.

Generating migrations is per-dialect and takes an explicit config — there is no
plain `drizzle.config.ts`, so there is deliberately no bare `db:generate` either:

```bash
npm run db:generate:sqlite        # → drizzle.config.sqlite.ts
npm run db:generate:postgresql    # → drizzle.config.postgresql.ts
npm run db:generate:mysql         # → drizzle.config.mysql.ts, also MariaDB

# db:studio:sqlite / :postgresql / :mysql open the schema browser the same way.
# Equivalently, without the scripts:
npx drizzle-kit generate --config drizzle.config.sqlite.ts
```

**MariaDB shares the MySQL track deliberately** and has no config of its own; it
is verified against a real MariaDB server rather than assumed compatible. A
schema change is not finished until all three dialects are generated — see
[CONTRIBUTING.md](./CONTRIBUTING.md).

The repository root is the FlowCMS **application** and is named `flowcms-app`;
the published package is `flowcms`, built from `src/Themes/contract` into
`packages/flowcms`. npm refuses to install a package under a package of the same
name, which is why the two differ. See
[`docs/distribution/packages.md`](./docs/distribution/packages.md).

## Creating a new site — `create-flowcms`

`packages/create-flowcms` generates a standalone FlowCMS project: a complete
application in a directory of your choosing, with its own package metadata, its
own git history, and nothing pointing back at this repository.

> `npx create-flowcms my-site` does **not** work yet — the package is not on npm
> (see [Project status](#project-status)). Today it runs from a local checkout
> or a packed tarball.

It asks for the deployment target, database, storage, Redis, admin path and
package manager, or takes them as flags for unattended use. Nothing about your
infrastructure is guessed, and no flag ever carries a secret: deployment secrets
are generated, and external ones come from masked prompts or `FLOWCMS_INSTALL_*`
environment variables.

What has and has not been exercised, so you can judge the risk:

| | Status |
| --- | --- |
| `npm` as the generated project's package manager | **Verified** end to end, on Windows |
| `pnpm`, `bun` | **Supported** — implemented and unit-tested, not run end to end |
| `yarn` | **Experimental** — the same, plus two unresolved risks named in the package-manager document |
| Windows | the CLI has been exercised here |
| macOS, Linux | expected to work; not exercised |

Whichever package manager you pick, **the site runs on Node** — choosing bun
chooses an installer, not a runtime.

See [`docs/distribution/package-managers.md`](./docs/distribution/package-managers.md)
for what each support level claims,
[`docs/distribution/create-flowcms.md`](./docs/distribution/create-flowcms.md)
and [`packages/create-flowcms/README.md`](./packages/create-flowcms/README.md).

## Configuration

Every variable is documented inline in [`.env.example`](./.env.example), grouped
by lifetime: values that must be in the environment because they decide how the
process boots, values the environment seeds but the admin panel can override,
and values that live only in the database.

The short version: `AUTH_SECRET` and `CAPTCHA_SECRET` are required.
`DATABASE_DIALECT` and `DATABASE_URL` (there is no longer a `DATABASE_PATH` —
its replacement is `DATABASE_URL=file:…`), `FLOWCMS_ADMIN_PATH`,
`FLOWCMS_SETUP_TOKEN`, `PREVIEW_SECRET`, `REDIS_URL`, `FLOWCMS_CSP` and the
`S3_*` group are optional, with sensible defaults or documented off-states.

Integration credentials — Google Search Console, Bing Webmaster Tools,
PageSpeed Insights, IndexNow — are **not** environment variables. They are
entered in the admin panel and stored in the database, which means a database
backup carries them. Treat one as a secret.

## Architecture

```
src/
  app/          Route files only — thin server components and API handlers
  Modules/      All UI and client state, one folder per feature
  Framework/    Cross-cutting services: Auth, Storage, Redis, Net, Security, …
  Themes/       Everything the public site renders, plus the theme contract
  components/   Shared Element* component library and shadcn primitives
  db/           Drizzle schema per dialect, migrations, and domain helpers
```

Two rules carry most of the structure: **no UI logic in `src/app/`**, and **no
database access in `src/Modules/`**. Route files check the session, await
`params`, and render a module; modules talk to the app's own `/api` routes.

Authorization is a **default-deny registry**: every API route declares a minimum
role in `src/Framework/Auth/routePolicies.ts`, and `requireApiAuth()` enforces
it. A route with no entry is denied, and a test fails the build if one is added
without a policy.

The admin path is **runtime-configurable**. `/admin-panel` is where the App
Router files live and is never a URL anybody sees; `src/proxy.ts` rewrites the
configured public path onto it. Never hardcode `/admin-panel` in a link.

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers the conventions a change has to
follow — the route/module split, the authorization policy registry, activity
logging, the admin-path helpers and the database rules. Read it before making a
substantial change.

## Writing a theme

A theme is a set of React surfaces plus a manifest, importing its types from the
`flowcms/theme` package subpath. It can live in `src/Themes/` or ship as an npm
package; `packages/flowcms-theme-aurora` is a worked example that proves the
public contract holds for an out-of-tree package.

Installing a theme is an explicit import in `src/Themes/registry.ts` (or
`packages.ts`) plus a rebuild — deliberately, because Next's build tracer
decides what reaches the production image, and a theme found by scanning a
directory at runtime would simply be absent from it. Activating an
already-installed theme is a runtime setting and needs no rebuild.

See [`docs/themes/authoring.md`](./docs/themes/authoring.md).

## Testing

```bash
npm run test
```

Vitest, Node environment, no database required. The suite covers the
security-critical surface: the role capability matrix, the route authorization
policy (including a check that every route on disk has a declared policy),
CAPTCHA signing and single-use, login rate limiting, JSON-LD escaping, SSRF
address classification, `LIKE` pattern escaping, upload key sanitisation, and
the security header policy.

It also enforces structural rules that a checklist would not survive:
`src/Framework` may not import `src/Modules`, no link may hardcode the internal
admin path, the business profile must never publish a value nobody configured,
and the generated `create-flowcms` template must contain every file the scripts
in its own `package.json` refer to.

## Security

Please report vulnerabilities privately — see [SECURITY.md](./SECURITY.md),
which also documents the known limitations of the current hardening.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Project status

Feature work for the first public release is complete: themes, multi-database
support, Docker, first-run setup, the theme package and the `create-flowcms`
scaffolder all exist and run from a checkout. What is still outstanding is
release, not product:

- **Publishing** — neither `flowcms` nor `create-flowcms` is on npm, and no
  release tag or GitHub release has been cut. Both packages are built and
  exercised locally from packed tarballs.
- **Forms / submissions** — the previous, trade-specific lead-capture feature
  was removed rather than generalised. A generic replacement is unscheduled.
- **Themes beyond the default** — the default theme's `/` is a deliberate
  placeholder page, and `packages/flowcms-theme-aurora` is a contract fixture
  rather than a theme anyone should ship a site on.

## Built with

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Drizzle ORM,
Auth.js v5, TanStack Query, Zod, TinyMCE (self-hosted), and shadcn/ui.
