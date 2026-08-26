# Contributing to FlowCMS

Thanks for taking the time. This document covers what you need to know to get a
change merged.

> **Licence note.** FlowCMS is licensed **GPL-2.0-or-later** — see
> [`LICENSE`](LICENSE). Contributions are accepted under those terms.

## Getting set up

```bash
npm install                # or: bun install
cp .env.example .env.local # fill in AUTH_SECRET and CAPTCHA_SECRET
npm run db:migrate         # creates the SQLite database at data/app.db
npm run dev
```

Then create the first owner account. Either open the site — it redirects to
`/setup` while the installation is uninitialized, and needs
`FLOWCMS_SETUP_TOKEN` in your `.env.local` — or run the CLI bootstrap, which
needs no token because shell access already is the authorization:

```bash
FLOWCMS_OWNER_EMAIL=you@example.com \
FLOWCMS_OWNER_PASSWORD='a long random password' \
  node scripts/bootstrap-owner.mjs
```

`npm run db:seed` is **development sample data only**, it is Bun-only, and it is
not how an installation is initialized. See
[`docs/setup/first-run.md`](./docs/setup/first-run.md).

Node.js 22+ is the primary supported runtime and the Docker image runs Node, so
the commands in this document use `npm`. Bun works for local development and the
repository keeps a `bun.lock`; substitute `bun run` freely. `package-lock.json`
is the lockfile the image builds from, and it must be regenerated **inside a
Linux container** — npm prunes platform-optional dependencies to the host OS, so
a lockfile generated on Windows or macOS omits `lightningcss-linux-x64-gnu` and
the image build fails at Tailwind.

Four package managers are implemented — npm, pnpm, yarn and bun — at different
levels of **evidence**, not intent: npm is the only one run end to end, and only
on Windows. `docs/distribution/package-managers.md` is the source of truth for
what each level claims. Do not upgrade a level anywhere without a run behind it.

If you add a script, prefer one that runs under plain Node. Anything in
`scripts/` that the image invokes *must* run under plain Node, because there is
no Bun in the image.

**No root script may delegate to another root script through a named package
manager.** Write `node scripts/foo.mjs`, not `npm run foo`: a script that says
`npm run` makes `pnpm test` run two thirds of its own suite under a different
manager's script runner, and needs npm on `PATH` for `bun run test` to work at
all. `tests/scaffolder/rootScripts.test.ts` fails on a violation, and it also
fails if a root script names a file the scaffolder template excludes without a
matching `DROPPED_SCRIPTS` or `REWRITTEN_SCRIPTS` entry — the root
`package.json` is both this repository's build file **and** the generated
project's manifest source, so the two halves must always move together.

**Line endings are decided by `.gitattributes`, not by your git config.** Git for
Windows installs with `core.autocrlf=true`, and a CRLF `docker/entrypoint.sh`
makes the kernel look for the interpreter `/bin/sh\r` — the container then exits
reporting that a path which obviously exists does not. `.gitattributes` pins LF
for everything a kernel or an image build executes. If you cloned before it
landed, run `git add --renormalize .` once, or re-clone.

## Before you open a pull request

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

All four must pass. Run them yourself before you push, whatever CI does or does
not check on your branch — a red pipeline is a slower way to learn something you
could have known in a minute.

`npm run test` builds the published package and the scaffolder template first,
because part of the suite asserts against the built artifacts rather than the
source they came from. That makes the first run noticeably slower than the rest.

## Reading before writing

- **This document** is the conventions reference. The section below covers the
  rules a change has to follow, and each one has a test behind it.
- **This is Next.js 16.** Several APIs differ from older versions and from most
  material online — `cookies()`, `headers()`, route `params` and `searchParams`
  are async; middleware is `src/proxy.ts`, exporting a function named `proxy`;
  `next lint` is gone, so run `eslint` directly. Check
  `node_modules/next/dist/docs/` rather than memory.
- **Then read the code.** The codebase comments the reasoning behind non-obvious
  decisions; those comments are the closest thing to a design document and they
  are kept current.

**After** your change: if it affects behaviour, configuration, APIs or anything
else users, operators or theme authors depend on, update the public
documentation in the same pull request.

## The conventions that matter most

### Route / module split

`src/app/` holds route files only. They check the session, `await params`, and
render a module. All UI and client state live in `src/Modules/`. Never put UI
logic in `src/app/`; never put database access in `src/Modules/`.

### The admin path is runtime-configurable — never hardcode it

`/admin-panel` is where the App Router files live. It is **not** a URL anybody
sees: the public path defaults to `/admin` and an operator can move it with
`FLOWCMS_ADMIN_PATH`, after which `src/proxy.ts` rewrites the configured path
onto the internal one.

- **Never hardcode `/admin-panel`** in a link, redirect or fetch.
- On the server, use `adminPath()` / `adminLoginPath()` from
  `@/Framework/Config/adminPath`.
- In client components, use `useAdminHref()` from
  `@/Framework/Config/AdminPathProvider`.
- Module-scope navigation tables store paths **admin-relative** and join them at
  render time, because a hook cannot be called at module scope.
- **Never introduce `NEXT_PUBLIC_FLOWCMS_ADMIN_PATH`.** `NEXT_PUBLIC_*` is
  inlined at build time, which would make the runtime override a fiction —
  server routing would move while every client-rendered link stayed behind. The
  root layout resolves the path on the server and passes it through context.

`tests/architecture/adminPathUsage.test.ts` fails the build on a violation.

### Authentication

`src/Framework/Auth/` is split into two NextAuth instances on purpose, and the
split is load-bearing:

- **`auth.config.ts` is database-free** — pages, JWT session strategy, empty
  providers, and the `authorized` / `session` callbacks. `src/proxy.ts` imports
  it, so it must never transitively pull in the database client.
- **`auth.ts` is the real instance** — it spreads `authConfig` and adds the
  Drizzle adapter, the Credentials provider and the `jwt` callback.

Two rules that are easy to get wrong:

- **`authorized` must return a redirect `Response`, never `false`.** next-auth
  dispatches through an `else if` chain: a `Response` wins, but when a wrapper
  middleware is present the boolean is *discarded*. Because `proxy.ts` wraps
  `auth()` to rewrite the admin path, returning `false` computes the right
  answer and throws it away — every protected page then renders for anonymous
  visitors. Keep the `callbackUrl` relative; an absolute one is the classic
  open-redirect shape. `tests/auth/adminPathAuthorization.test.ts` pins this.
- **Credential validation belongs inside `authorize()`**, not in a step before
  `signIn`. The proxy matcher deliberately excludes `/api`, so it never sees
  `/api/auth`; `authorize()` is the only point every sign-in attempt provably
  passes through. That is why the CAPTCHA check and the login rate limiter both
  live there. A guard placed anywhere earlier can be skipped by posting straight
  at the callback endpoint.

API routes stay governed by the route-policy layer below; none of this replaces
it.

### Every API route declares an authorization policy

This is the one rule with a test that will fail your build if you skip it.

Add your route's pattern to `ROUTE_POLICIES` in
`src/Framework/Auth/routePolicies.ts` with the minimum role it needs and a
written reason, then gate the handler:

```ts
export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate
  // ...
}
```

A route with no policy entry is **denied at runtime**, and
`tests/auth/routeCoverage.test.ts` fails. That is deliberate: it is how a new
endpoint cannot ship unauthorized by omission.

The policy is a floor. If your route needs a finer rule — post ownership, "only
an owner may grant the owner role" — apply it in the handler as well, using the
functions in `src/Framework/Auth/permissions.ts`. Do not invent a parallel role
system.

### API response shape

```ts
// success
return NextResponse.json({ data, message: "Foo created" })

// validation failure — always 422, message is a string or string[]
return NextResponse.json(
  { message: parsed.error.issues.map((i) => i.message) },
  { status: 422 }
)
```

Zod schemas are shared with the client: import them from
`src/Modules/**/Values/Validations.ts` rather than redefining them.

### Every write records activity

After a write succeeds, call `recordActivity()` from `src/db/activityLog.ts`. It
never throws — an audit entry must never fail the operation it describes. The
vocabulary lives in `src/Framework/Activity/activityTypes.ts` and the per-entity
column labels in `fieldLabels.ts`. A column absent from those maps is never
named in a summary, which is how `updatedAt`, derived scores, and every secret
stay out of the log. Bulk operations get one entry for the batch.

### Module layout

```
src/Modules/FooBar/
  FooBarModule.tsx            # list view, filter state, drawer/modal state
  Components/Foo{Create,Edit}Drawer.tsx
  Services/FooBarServices.ts  # BAPI wrappers around this app's own /api routes
  Types/index.ts
  Values/FooBarValues.tsx     # buildColumns(...), badges, slugify
  Values/Validations.ts       # Zod schemas + inferred form value types
```

Data fetching is TanStack Query; mutations call the service then
`invalidateQueries`. Validation errors (422) render inline through
`<ValidationBox>`, never as a toast.

## Tests

Vitest, in `tests/`, Node environment, no database needed.

**Write the test first and watch it fail.** A test written after the code passes
immediately, which proves nothing about whether it can catch the bug.

Anything touching authentication, authorization, escaping, or input validation
needs a test. If you fix a security bug, add a test containing the payload that
exercised it.

## Working with the database

- Change `src/db/schema/*.ts`, then generate a migration **for each track** —
  there are three migration directories under `src/db/migrations/`
  (`sqlite/`, `postgresql/`, `mysql/`), and a schema change that only lands in
  `sqlite/` breaks the other three engines:

  ```bash
  npm run db:generate:sqlite
  npm run db:generate:postgresql
  npm run db:generate:mysql        # also MariaDB
  ```

  Each script passes `--config drizzle.config.<dialect>.ts`; `npx drizzle-kit
  generate --config …` does the same thing if you prefer to type it. **There is
  no bare `db:generate` or `db:studio`** — there is no plain
  `drizzle.config.ts` for a config-less `drizzle-kit` invocation to find, so a
  generic script could only ever fail, and it was removed rather than left
  looking usable. **MariaDB shares the MySQL config and migration track on
  purpose**; do not add a fourth Drizzle config for it.
- Do not hand-edit generated migrations, and do not rewrite existing ones —
  always add a new forward migration.
- Multi-table writes go through `db.transaction`.
- Do not interpolate values into `LIKE` patterns. Use `likeContains()` from
  `src/db/likeEscape.ts`, which escapes `%` and `_`.
- **Keep queries dialect-agnostic.** SQLite, PostgreSQL 17, MySQL 8.4 and
  MariaDB 11.4 are all supported, from one image, chosen at runtime — so a
  query that only works on one of them is a bug in three deployments.
  `.returning()` in particular has no MySQL equivalent.
- Runtime queries import tables from `@/db/tables` (the active dialect), never
  from `@/db/schema`. Importing the schema directly binds a query to SQLite and
  produces defects that only appear on PostgreSQL.
- Email identity is normalised in the application with `normalizeEmail` before
  every store and lookup, because MySQL and MariaDB compare case-insensitively
  and PostgreSQL and SQLite do not. Do not leave case-folding to collation.

## Runtime constraints

Bun can run the dev server here, but **Node is the runtime FlowCMS ships on** —
the Docker image is `node:22-bookworm-slim` and a generated project runs under
Node whichever package manager installed it. And **Bun-native APIs do not work
inside Next-compiled server code** either way — Turbopack's server-chunk loader
cannot resolve `bun:sqlite`, and
the `Bun` global is undefined in route handlers. That is why the stack uses
`@libsql/client` rather than `bun:sqlite`, and `bcryptjs` rather than
`Bun.password`. Any new native dependency also needs adding to
`serverExternalPackages` in `next.config.ts`.

## Adding a top-level file

`create-flowcms` builds its application template from an **allowlist** in
`scripts/lib/templateManifest.mjs`, not from "the repository minus some
ignores". A new top-level file is therefore absent from every generated project
until somebody lists it — which is the safe direction, but it does mean a new
config file the application needs at runtime has to be added there in the same
pull request.

The reverse is equally deliberate: repository governance (this file,
`SECURITY.md`, `CODE_OF_CONDUCT.md`, `.github/`), maintainer-only material, and
FlowCMS's own release tooling are **not** in the allowlist and must not be
added to it. They
describe developing FlowCMS; a generated project is somebody else's site, and
shipping this project's conduct policy into it would be nonsense.

**Never list a git-ignored file in the allowlist.** The template build fails
when a `FILES` entry does not exist on disk, so an ignored file makes `npm test`
fail on every fresh clone while passing on the machine of whoever added it —
their working copy has the generated file, a clone does not.
`next-env.d.ts` is the worked example: Next generates it, Next's own shipped
documentation says twice not to track it, and the copy here imports build
output. Its two ambient references live in the tracked `src/next-globals.d.ts`
instead, which ships with `src/` and needs no entry of its own.
`tests/scaffolder/freshClone.test.ts` pins the rule.

See [`docs/distribution/create-flowcms.md`](./docs/distribution/create-flowcms.md).

## Commits and pull requests

- One logical change per pull request. Security fixes separate from features.
- Explain *why*, not just what. This codebase comments the reasoning behind
  non-obvious decisions, and pull request descriptions are held to the same bar.
- Say what you ran and what it printed. "Tests pass" without output is not
  evidence.
- **Check your diff for secrets before you push.** No `.env`, no database file,
  no S3 key, no integration token, no local credentials scratch file.
  `.gitignore` covers the filenames these usually arrive under, but it cannot
  cover a value pasted into a source file or a test fixture.
- The pull request template lists the checks that catch the mistakes this
  codebase actually makes. It is short on purpose; please do not delete it.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Reporting security issues

Do not open a public issue. See [SECURITY.md](./SECURITY.md).
