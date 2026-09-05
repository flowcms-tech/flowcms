# Changelog

All notable changes to FlowCMS are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
FlowCMS uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] — 2026-09-05

The release that makes the File Manager one thing. The dialog an editor opened
from a form field was never a reduced File Manager — it was a second
implementation of one, which is why it could not upload, create a folder,
rename, move or delete. There is now a single browser behind both surfaces, so
a feature added to it arrives in both at once, and the features added here
prove it.

### Added

- **Image conversion**, from a file's action menu: pick a target format, a name
  and a destination folder. WebP, AVIF, PNG and JPG. The result is a **new
  object and the source is never modified or removed** — storage keys are this
  application's foreign keys, held in eight columns and written into post
  bodies, so a route that can only ever add cannot orphan a reference. The
  route refuses a destination that would overwrite the source or a bystander,
  the format a file already is comes back disabled, and a decode is bounded at
  25 megapixels because a byte cap is not a pixel cap.

- **Preview**, for images, opening the authenticated media route in a new tab.
  The public image route would be wrong here: it serves a key only when
  published content references it, so anything freshly uploaded would 404.

- **A Properties dialog** for what a listing already carries — preview, name,
  kind, size beside its exact byte count, location, path, admin URL,
  modification time, and for images the dimensions measured off the decoded
  preview. The stored MIME type, ETag and checksum are absent rather than
  guessed: the storage driver exposes no head operation.

- **Download**, as a real link, in the actions menu and in Properties.

- **SVG and AVIF** as allowed image formats.

### Changed

- **The file picker is the File Manager.** `FileManagerModule` became
  `FileManagerBrowser` and takes one optional `selection` prop; the admin page
  and the new picker dialog are shells that render it and contain no
  file-manager UI of their own. The picker therefore uploads, creates folders,
  renames, moves and deletes, because there is no longer a second place for a
  feature to be missing from. `ElementFileSelector` keeps its props exactly, so
  all fifteen call sites and the TinyMCE toolbar button are untouched.

- **`accept` governs what may be returned, never what is shown.** A folder
  looks identical in both shells, files that cannot be chosen are dimmed rather
  than hidden, and a file the picker will not accept can still be renamed or
  moved from inside it.

- **Rename and New Directory are forms, not confirmations.** They shared a
  confirmation dialog wrapping a bare input, which gave them a warning triangle
  no rename deserves and reported a refused name in a corner toast. They now
  submit on Enter and show errors under the field. Renaming a file no longer
  lets the extension be retyped: the field holds the stem and the extension is
  a locked cell beside it.

- **Directory tree.** Every visible row lists its own prefix, so a folder with
  no subdirectories no longer offers an expander that opens onto nothing — one
  request per rendered node in exchange for the answer, and for expansion
  becoming instant. Rows carry their own vertical margin, so adjacent hover and
  selection fills no longer read as one block.

- **Shared components.** `ElementModal.Confirm` and `.Warning` render a close
  button; the modal header's order is corrected for the app's fixed `dir="ltr"`
  using logical properties; an `xl` size hosts a screen rather than a form; and
  `onOpenAutoFocus` lets a form dialog claim the caret. `ElementTable` gains
  `onRowClick` and `rowClassName`, with the checkbox and expander cells no
  longer propagating a click. `ElementInput`'s addon variant shows a focus
  state again.

### Fixed

- **The upload button did nothing after a file was chosen.** The handler
  captured `e.target.files` and then reset the input to allow re-selecting the
  same file; `input.files` is a live `FileList`, so the reset emptied it before
  it was read and the handler bailed on the length check with no request and no
  error. Drag-and-drop was unaffected.

- A 3 GB file read as `3072.0 MB`. `formatBytes` had been copy-pasted into
  three places; it lives once now and has the GB step.

- The Upload button and the view toggle were 28px and 34px against each other.

### Security

- **SVG is served, and its execution removed.** Both media routes refused SVG
  on purpose: it can carry `<script>`, event handlers and `<foreignObject>`, so
  serving it as `image/svg+xml` from the admin origin was stored XSS with a
  session attached. Handing it over as an attachment closed that at the cost of
  making the format useless — a theme renders a logo with `<img>`. It is now
  served inline under `default-src 'none'; style-src 'unsafe-inline'; sandbox`,
  which puts the response in an opaque origin that can neither run a script nor
  reach the network. Inline styles stay, because ordinary illustrations rely on
  them.

- The **public** image route is covered by this for the first time. Its
  responses are anonymous and come from the site's own origin, where a
  scriptable SVG would be stored XSS against every visitor rather than against
  one administrator.

- Both routes claimed in a comment that every allowed image extension has a
  content-type entry, which is what makes their `application/octet-stream`
  fallback unreachable. An invariant test now enforces it — adding two
  extensions is exactly how that claim goes stale.

- The conversion route is placed at `contributor`, with upload rather than with
  rename and delete: it cannot break a published post, and a contributor could
  already upload a converted copy by hand. The authorization matrix records the
  entry and the reasoning beside it.

### Known limitations

- The SVG Content-Security-Policy is load-bearing, so a proxy that strips
  response headers strips this protection with them. Entity-expansion denial of
  service in an SVG parser is untouched, being a parsing concern rather than an
  execution one.

- GIF is not offered as a conversion target although the encoder can write one:
  a single frame at 256 colours is a worse result than anything else on the
  list, so accepting it would only let someone degrade an image by accident.
  SVG is impossible as a target — nothing rebuilds a vector description from
  pixels.

- Conversion adds; it never replaces. Replacing an image in place needs
  reference rewriting first, which is also the latent flaw in rename.

## [0.2.0] — 2026-09-01

The release that makes storage a choice. FlowCMS required S3-compatible object
storage; it now runs on the local filesystem or on S3, the two are the same
thing to everything above them, and an installation can move from one to the
other after it is in use.

### Added

- **Local filesystem storage.** A deployment no longer needs an object store, a
  bucket or a credential to run — `/data/uploads` under Docker, `./data/uploads`
  on local Node. The path is deployment-controlled and never accepted from a
  browser.

- **A provider-neutral `StorageDriver` seam.** Uploading, reading, deleting and
  listing are one interface with two implementations behind it. Nothing above
  the driver knows which one it has, which is what makes the choice a
  deployment decision rather than a rewrite.

- **An explicit, verified storage migration workflow.** Moving between backends
  is a deliberate sequence rather than a settings toggle: test the destination,
  take an inventory, analyse compatibility, copy, verify every object by
  SHA-256, take a final write lock, replay the live delta, then commit the
  cutover in one transaction. It is resumable, and it recovers from a crash in
  the critical window using the persisted topology as the authority.

  **The previous storage is always retained.** FlowCMS never empties a bucket
  and never deletes a Local directory. Rolling back is another verified
  migration, not a toggle.

- **Authenticated private media delivery** at `/api/media/[...key]`, and
  **public media authorisation** at `/api/public/images/[...key]` for the
  anonymous access that crawlers need.

- **A durable record of the active storage topology.** The environment proposes;
  the persisted snapshot decides. Editing a variable on an established site no
  longer silently relocates it — the mismatch is reported instead.

- **Local and S3 as installer choices.** `create-flowcms` asks, and generates
  the matching `.env` and Compose overlay.

### Changed

- **The browser is no longer handed presigned S3 URLs.** Every image is served
  by FlowCMS. This also fixes a latent bug on bundled-Garage deployments, where
  every presigned thumbnail URL named `http://garage:3900` — a hostname only
  resolvable inside the Docker network, and never from a browser.

- **Object keys and public URLs are stable across a migration.** Nothing in the
  database is rewritten, so a move changes where bytes live and nothing else.

- **First-run setup was reworked.** "Site name" and "Tagline" are labelled Site
  Title and Description, matching what they actually feed. The owner password
  floor drops from twelve characters to six, matching every other admin account.
  The System checks card is gone; it gated nothing, and `POST /api/setup`
  re-checks prerequisites server-side regardless.

  The installer now prints the setup token in full rather than naming the file
  it lives in. That is a deliberate reversal of the rule `create-flowcms` was
  written with: the token authorises one action once, the endpoint is gone
  afterwards and the value is inert, and an operator who cannot find it is stuck
  on the first screen they ever see. Terminal output only — no other generated
  secret is ever printed.

- **S3-compatible storage and bundled Garage are unchanged.** Garage remains
  infrastructure, not a driver: the S3 driver cannot tell it apart from AWS,
  R2, B2 or Wasabi, which is exactly what lets an operator move between them.

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

- **Every 404 on the public site crashed in development** with "Only plain
  objects … can be passed to Client Components from Server Components".
  `themeSettingsResolve` builds its settings bag with `Object.create(null)` on
  purpose, so a stored key named `__proto__` can never reach `Object.prototype`
  — and React's serializer refuses a null-prototype object outright. The copy
  now happens at the two points where settings stop being internal state and
  become component props, so resolution keeps its hardened object and only what
  crosses into a component is plain.

- **Two defects that would have made storage migration inoperable on three of
  the four supported databases**, both found by running the engine on something
  other than SQLite. Conditional writes counted affected rows as
  `rowsAffected ?? rowCount` — libsql's shape and nobody else's — so on
  PostgreSQL, MySQL and MariaDB every state transition read zero and threw. And
  `upsert`'s injectable executor branched on the *ambient* dialect rather than
  the executor's, handing a MySQL executor a builder method it does not have.

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

[Unreleased]: https://github.com/flowcms-tech/flowcms/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/flowcms-tech/flowcms/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/flowcms-tech/flowcms/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/flowcms-tech/flowcms/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/flowcms-tech/flowcms/releases/tag/v0.1.0
