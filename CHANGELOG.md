# Changelog

All notable changes to FlowCMS are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
FlowCMS uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Nothing has been released yet** (see
> [Project status](README.md#project-status)). `0.1.0` below is a *preparation*
> section describing what the first release will contain when it happens — it is
> not a shipped version and carries no date. Do not add a date, a tag reference
> or a comparison link to it until the release is actually cut.

## [Unreleased]

Nothing yet. Changes made after `0.1.0` is cut go here.

## [0.1.0] — preparation, not yet released

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

<!--
No comparison links. Nothing has been tagged yet, so a link reference here
would point nowhere. Add the `[Unreleased]` and `[0.1.0]` link definitions in
the same change that cuts the first tag.
-->
