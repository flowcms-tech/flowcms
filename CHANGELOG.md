# Changelog

All notable changes to FlowCMS are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
FlowCMS uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **The login CAPTCHA drew no security code, so nobody could sign in to the
  admin panel.** `/api/captcha` asked for `bold 26px sans-serif`, and
  `sans-serif` is not a font — it is a request that the host resolve one. The
  runtime image is `node:22-bookworm-slim`, which ships no fonts at all: no
  `/usr/share/fonts`, no fontconfig. `@napi-rs/canvas` matched nothing,
  `measureText()` returned width 0, and `fillText()` drew zero pixels.

  It failed in the way least likely to be noticed. The captcha's background and
  its noise lines are geometry rather than glyphs, so they rendered perfectly —
  the login page showed a normal-looking captcha box containing a faint squiggle
  and no code. The response was a 200, the PNG was valid, and the cookie carried
  a correctly signed challenge. Every part of the CAPTCHA worked except the part
  a human has to read.

  The application now carries its own font. Geist Mono Bold (SIL Open Font
  License 1.1, already a pinned dependency) is committed under
  `src/Framework/Captcha/fonts/` and registered under a private family name, so
  the image renders identically on a fontless container, on a contributor's
  laptop, and on whatever base image a self-hoster picks. The runtime image also
  installs `fonts-dejavu-core`, which gives the generic families a real answer
  for anything else that renders text.

  Note that no configuration check could have caught this. `CAPTCHA_SECRET` was
  set and valid, so startup validation, readiness, the route's own 503 guard and
  the first-run prerequisites all correctly reported a healthy deployment. They
  ask whether a challenge can be *signed*; whether it can be *seen* is a
  different question.

## [0.1.1] — 2026-08-27

A CLI release. The application itself is unchanged; everything below is
`create-flowcms`, plus one validation fix that decides what a generated `.env`
contains.

### Changed

- **The `create-flowcms` interactive installer is rebuilt on
  [`@clack/prompts`](https://www.npmjs.com/package/@clack/prompts).** Choices
  are navigated with ↑/↓ and Enter rather than typed as numbers, a submitted
  answer collapses to a single line, and the pre-flight configuration and the
  closing next-steps are shown as framed blocks. Scaffolding steps report
  through a spinner, and the run ends with a summary rather than trailing
  output.
- **`@clack/prompts` is now a dependency of `create-flowcms`** — its first, and
  the only one it has. The package's "zero dependencies" rule becomes "one,
  named": a second bare import fails the test suite.
- The masked prompts no longer warn that input might be echoed. They do not
  need to: the mask is drawn rather than raced against the terminal's own echo,
  so there is no longer a terminal state in which masking silently stops.

### Fixed

- **A local deployment of PostgreSQL, MySQL or MariaDB with an empty external
  database URL no longer produces a broken `DATABASE_URL`.** Pressing Enter at
  the connection-URL prompt returned an empty string, which was falsy in every
  check downstream; the generated `.env` then received
  `postgresql://flowcms:null@localhost:5432/flowcms` — a literal `null`
  password — with nothing reported. The URL is now required at the prompt and
  the configuration is refused by validation if it is missing.
- An interrupted prompt whose terminal goes away — rather than being cancelled
  with Ctrl+C — no longer leaves the installer waiting forever.

### Unchanged, deliberately

- **Non-interactive and CI behaviour is byte-for-byte what it was.** A run
  without a TTY prints the same plain lines, emits no ANSI escapes, and still
  refuses to guess: missing configuration is a usage error naming the flag.
- Every CLI flag, every `FLOWCMS_INSTALL_*` variable, the destination safety
  rules, secret generation, template copying, `.env` and Compose rendering,
  package-manager detection and spawning, cleanup ownership, `--skip-install`,
  and every exit code — including `130` for an interrupted run and the rule
  that a failed dependency install keeps the generated project.

## [0.1.0] — 2026-08-27

The first public release of FlowCMS: a self-hosted CMS that is a genuine
fullstack application — a public themed site and an admin panel, with its own
API, database and object storage, and no external backend.

### Added

**Content**

- **Blog** — posts, categories, tags and authors, with drafts, scheduled
  publishing (applied lazily on the next read, so no cron is required), a
  review/approval flow, and shareable signed draft-preview links.
- **SEO** — per-post metadata, canonical URLs, Open Graph and Twitter cards,
  JSON-LD structured data (Article, FAQ, HowTo, Review, Video, Breadcrumb),
  a table of contents, reading time, related posts and series, sitemaps, RSS
  and `robots.txt`.
- **Custom pages** — arbitrary public URLs rendered through the theme system.
- **Redirects** — operator-managed redirect rules.
- **Activity log** — an append-only audit trail of every write, with per-entity
  field labelling, read-only in the admin panel and pruned on a retention
  window.

**Presentation**

- **Theme system** — all public presentation lives in `src/Themes/`. Themes are
  *installed* at build time via a static registry and *activated* at runtime
  from Appearance, with per-theme settings, menus and an appearance screen. A
  persisted theme slug that this build does not carry falls back to the default
  and is never rewritten.
- **`flowcms/theme`** — the public theme API, built from `src/Themes/contract`
  into the `flowcms` package: view models, surface props, settings helpers,
  `JsonLd`, `publicImageUrl`, `readingTime`, `cn` and `FLOWCMS_VERSION`. One
  package, one public subpath; deep imports are closed by the `exports` map.

**Administration**

- **Admin panel** at `/admin` by default, movable to any path at runtime via
  `FLOWCMS_ADMIN_PATH`. The internal route is not a second way in.
- **Roles and a default-deny route registry** — every API route declares a
  minimum role, a path with no policy is denied, and a test walks the route tree
  on disk so the registry cannot rot.
- **Authentication** — credentials sign-in with a server-verified CAPTCHA and
  per-email and per-IP rate limiting, both applied inside `authorize()` so no
  request path can skip them. Near-instant revocation via a bounded freshness
  re-read.
- **Admin users** — invite, role assignment, activation and deactivation.
- **File manager** — S3-backed browsing, upload, rename, move and delete, with
  images served only through short-lived presigned URLs.
- **Settings** — site identity, business profile, and integration
  configuration.
- **Search Console and Bing Webmaster Tools integrations** — cross-source action
  feed, page profiles and role-based views.

**Operations**

- **Four databases from one image** — SQLite, PostgreSQL 17, MySQL 8.4 and
  MariaDB 11.4, selected by `DATABASE_DIALECT` + `DATABASE_URL`, with a Compose
  overlay per engine. Email identity is normalised in the application rather
  than left to collation.
- **Docker** — a Node production image, migrations at container start, `/api/health`
  for liveness and `/api/ready` for readiness, and a bundled Garage S3 service.
  Redis is opt-in; without it the login limiter falls back to a per-process
  implementation.
- **First-run setup** — `/setup` creates the first owner and site identity,
  gated by a `FLOWCMS_SETUP_TOKEN` that fails closed, guarded against
  concurrent claims, and closed permanently by a durable marker.
- **`create-flowcms`** — a zero-dependency scaffolder that generates a
  standalone FlowCMS project: deployment mode, database, storage, Redis, admin
  path and package manager, with a generated `.env`. No CLI flag carries a
  secret, and nothing prints one.

### Security

- CAPTCHA expiry is carried inside the signed payload and single use is enforced
  server-side, so a client that ignores `Set-Cookie` gains nothing.
- Draft-preview signing fails closed: with `PREVIEW_SECRET` unset the feature is
  simply off, and rotating it revokes every outstanding link.
- JSON-LD output is escaped, SSRF destinations are address-classified, `LIKE`
  patterns are escaped, upload keys are sanitised, and a security-header policy
  is asserted by tests.
- Setup tokens are never placed in a URL and never printed by the scaffolder.

### Known limitations

- FlowCMS is licensed **GPL-2.0-or-later**; see [`LICENSE`](LICENSE). Both
  publishable packages still refuse to publish until the release is cut.
- A generated project carries a **local copy** of the `flowcms` package
  (`file:packages/flowcms`) because `flowcms` is not on npm. This is the
  decision of record for v0.1, not a stopgap — see
  [`docs/distribution/create-flowcms.md`](docs/distribution/create-flowcms.md).
- No release automation is wired up yet; see `docs/ci.md` when it lands.

[Unreleased]: https://github.com/flowcms-tech/flowcms/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/flowcms-tech/flowcms/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/flowcms-tech/flowcms/releases/tag/v0.1.0
