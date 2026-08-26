# Running FlowCMS with Docker

FlowCMS ships as a single Node.js image with a persistent SQLite volume and an
optional bundled S3-compatible object store.

## Quick start

```bash
cp .env.example .env
# Edit .env: set AUTH_SECRET, CAPTCHA_SECRET, FLOWCMS_SETUP_TOKEN and the two
# GARAGE_* credentials. Generate every one of them randomly — the placeholders
# in .env.example are refused, on purpose.
#   openssl rand -base64 32     # AUTH_SECRET, CAPTCHA_SECRET, PREVIEW_SECRET
#   openssl rand -base64 32     # FLOWCMS_SETUP_TOKEN
#   openssl rand -hex 16        # GARAGE_ACCESS_KEY_ID
#   openssl rand -base64 32     # GARAGE_SECRET_ACCESS_KEY

docker compose up -d
```

This starts the application and Garage. Open `http://localhost:3000/admin` once
the container reports healthy:

```bash
docker compose ps
curl -s localhost:3000/api/ready
# {"status":"ready","database":"ok","storage":"connected"}
```

Then create the first owner — explicitly, because nothing creates one for you:

```bash
docker compose run --rm \
  -e FLOWCMS_OWNER_EMAIL=you@example.com \
  -e FLOWCMS_OWNER_PASSWORD='choose-a-long-unique-password' \
  -e FLOWCMS_OWNER_NAME='Your Name' \
  --entrypoint node app scripts/bootstrap-owner.mjs
```

That is the whole install on SQLite. To use PostgreSQL, MySQL or MariaDB
instead, see [Choosing a database](#choosing-a-database) — the image is the
same, only configuration changes.

## What runs

| Service | Default | Purpose |
|---|---|---|
| `app` | on | FlowCMS. Published on `${FLOWCMS_PORT:-3000}`. |
| `garage` | on | Bundled S3-compatible object storage. No published ports. |
| `redis` | off (`--profile redis`) | Optional cache and shared rate limiter. |

```bash
docker compose --profile redis up -d          # add Redis
docker compose -f compose.yml -f compose.external-s3.yml up -d   # no Garage
docker compose -f compose.yml -f compose.dev.yml up              # dev, hot reload
```

## Database and persistence

SQLite lives at `/data/app.db` on the named volume `flowcms-data`. No database
file is ever built into the image.

The build compiles the repository's local packages before it compiles the
application. `flowcms` (the published theme API) and the example theme are
`file:` dependencies, so the deps stage copies their manifests — `npm ci` reads
each one to build the tree and refuses to run without them — and the builder
stage runs `scripts/build-package.mjs` and `scripts/build-example-theme.mjs`
before `next build`. A theme resolves `flowcms/theme` to
`packages/flowcms/dist`, so if that were not compiled first the failure would be
a missing module several minutes into the Next build rather than at the step
that caused it. See [`docs/distribution/packages.md`](./distribution/packages.md).

The builder stage sets `ENV NODE_OPTIONS=--max-old-space-size=4096` as well as
passing the same flag on the build command. That is not belt-and-braces: Next
forks a separate worker for the type-check phase, and a fork inherits the
environment rather than the parent's command-line flags, so the worker otherwise
falls back to V8's container-derived default (~2 GB) and the build dies of a JS
heap OOM inside TypeScript while the parent still has headroom it never used.

**The runtime stage deliberately does not set it.** The production server has no
type-check phase, and a 4 GB ceiling on a long-lived process is a poor trade on
a small VPS — it lets a leak grow to 4 GB before Node reacts instead of failing
early. If you are building on a machine with little memory, raise the value in
the builder stage only.

Migrations run **at container start**, before the server binds — not at build
time (a build has no volume) and not lazily on first request (that hides
failure behind a 500). If a migration fails the entrypoint exits non-zero and
the container does not serve.

Data survives `docker compose restart`, `docker compose down`, and
`docker compose up`. It is destroyed by `docker compose down -v`, which removes
volumes — that is the only command that deletes your content.

### Backup

```bash
docker compose exec app node -e "..."           # or simply stop and copy:
docker run --rm -v flowcms_flowcms-data:/data -v "$PWD:/backup" \
  debian:bookworm-slim cp /data/app.db /backup/app.db.bak
```

Back up `flowcms_garage-data` and `flowcms_garage-meta` the same way if you use
the bundled Garage — the database references objects that live there.

## Health and readiness

Two endpoints, answering different questions.

`GET /api/health` — **liveness**. Is the process running? Touches nothing else,
so a dependency blip cannot cause a restart loop.

```json
{ "status": "ok" }
```

`GET /api/ready` — **readiness**, and the Docker healthcheck target. Can this
instance serve traffic? Returns `503` when not.

```json
{ "status": "ready", "database": "ok", "storage": "not_configured" }
```

Only the database gates readiness. **Storage does not.** A fresh install has no
bucket configured, and marking that unready would have Docker restarting the
container while you were in Settings entering the credentials that would fix
it. Storage state is reported for operators and ignored by the verdict.

| Field | Values |
|---|---|
| `status` | `ready`, `not_ready` |
| `database` | `ok`, `unavailable`, `migrations_pending` |
| `storage` | `connected`, `not_configured`, `connection_failed` |

These endpoints are unauthenticated, so they return states and nothing else —
no hostnames, bucket names, credentials, or error text. Diagnose failures from
`docker compose logs app`.

The healthcheck is an HTTP request, deliberately, not a port check: FlowCMS can
bind its port while serving nothing but 500s (see *Invalid configuration*), and
a TCP probe reports that as healthy.

## Admin path

The panel is at `/admin` by default and moves at runtime:

```bash
FLOWCMS_ADMIN_PATH=/secure-console docker compose up -d
```

No rebuild — the same image serves any configured path. The internal route
`/admin-panel` always returns 404 to a browser; it is an implementation detail,
not a second way in.

Reserved values are rejected (`/api`, `/blog`, `/preview`, `/sitemap`,
`/admin-panel`, `/robots.txt`, `/_next`, `/`). Nested paths such as
`/internal/admin` work.

### Invalid configuration

An invalid `FLOWCMS_ADMIN_PATH` is rejected at startup. The log names the value
and the reason, every request returns 500, and the container goes **unhealthy**:

```
Failed to prepare server Error: An error occurred while loading instrumentation hook:
  Invalid FLOWCMS_ADMIN_PATH: "/api" — "/api" is a reserved FlowCMS route.
```

The process stays alive (Next binds its port before the hook runs), which is
exactly why the healthcheck queries `/api/ready` rather than watching the exit
code. It never falls back to exposing `/admin-panel`.

## Storage

### Garage (bundled, default)

Garage v2.3.0, single node, `replication_factor = 1`. It bootstraps itself with
`--single-node --default-bucket`, creating the layout, bucket and access key
from `GARAGE_*` in your `.env`. That is idempotent: restarts do not regenerate
credentials, recreate the layout, or touch existing objects.

Credentials are **yours** — supplied through the environment rather than
generated and printed to a log. FlowCMS reaches Garage at `http://garage:3900`
over the Docker network; no Garage port is published. The browser never talks to
object storage directly: images are served through `/api/public/images/…` and
presigned URLs are generated server-side.

This is a single-node topology suitable for self-hosting, not a
high-availability cluster. Production HA Garage is a separate operational
concern — see the [Garage cookbook](https://garagehq.deuxfleurs.fr/cookbook/real_world.html).

### External S3

Any S3-compatible provider works — AWS S3, Cloudflare R2, Wasabi, Backblaze B2,
DigitalOcean Spaces. Set the `S3_*` values in `.env` and start without Garage:

```bash
docker compose -f compose.yml -f compose.external-s3.yml up -d
```

The `GARAGE_*` values can be left unset in this mode — they are read by the
Garage service, which this overlay switches off, and by nothing else. Compose
does not enforce them, and deliberately cannot: it interpolates every file
before it merges overrides and filters profiles, so a required-variable guard on
the `garage` service would fire here too and refuse a topology that does not run
it.

There is no Garage-specific code in FlowCMS. The storage layer speaks the S3 API
with path-style addressing and does not know or care which implementation
answers. You can equally leave storage unset and configure it later in
**Admin → Settings → Global**, which takes precedence over the environment.

## Redis

Optional. Without it, the login rate limiter falls back to a per-process
in-memory implementation: still limiting, but not coordinated across replicas,
and reset when the container restarts. A single instance does not need Redis.
Enable it when running more than one.

```bash
docker compose --profile redis up -d
```

Redis is never published to the host.

## Environment variables

| Variable | Class | Notes |
|---|---|---|
| `AUTH_SECRET` | **required** | Signs every session token — whoever holds it can forge an administrator session. Compose refuses to start without *a* value; the application validates its *strength*, so a weak or example value means `/api/ready` reports `auth: "missing"`/`"unsafe"`, the container is **not ready**, and first-run setup refuses. Rotating it signs every user out, which is expected. All replicas need the same value; FlowCMS never generates one. |
| `FLOWCMS_ADMIN_PATH` | validated if present | Default `/admin`. Invalid → startup failure. |
| `DATABASE_DIALECT` | required for remote DBs | `sqlite` (default), `postgresql`, `mysql`, `mariadb`. |
| `DATABASE_URL` | set by the image for SQLite | `file:/data/app.db`, or a `postgresql://`/`mysql://` URL. |
| `CAPTCHA_SECRET` | **required** | Signs the login CAPTCHA. Absent or weak → `/api/ready` reports `captcha: "missing"`/`"unsafe"` and the container is **not ready**; first-run setup refuses to complete. It does **not** disable the CAPTCHA — there is no such state, and without it nobody can sign in. |
| `PREVIEW_SECRET` | optional | Absent disables shareable draft previews (fails closed). |
| `FLOWCMS_SETUP_TOKEN` | required to use `/setup` | Authorizes web first-run setup. Absent → the form is locked and says so; use `scripts/bootstrap-owner.mjs` instead. |
| `REDIS_URL` | optional | Absent uses the in-process limiter. |
| `BASE_URL` | optional | Server-side URL generation. Settings overrides it. |
| `S3_*` | optional, DB-backed | Env is a fallback; Settings takes precedence. |
| `GARAGE_*` | Garage-only | Consumed by the `garage` service, not by FlowCMS. |

`.env` and `.env.local` are never committed. `.env.example` carries placeholders
only. For staging and production, supply values through your deployment
environment — Next.js does not load `.env.staging`, and FlowCMS does not
pretend otherwise.

## Upgrading

```bash
docker compose pull   # or: docker compose build --pull
docker compose up -d
```

Migrations run automatically on start. Back up the volume first.

## Ports

| Port | Exposure | Why |
|---|---|---|
| 3000 (app) | published | The application. |
| 3900 (Garage S3) | internal | Reached by the app over the Docker network. |
| 3901 (Garage RPC) | internal | Cluster transport. |
| 3903 (Garage admin) | internal | Can reconfigure the cluster. Never publish. |
| 6379 (Redis) | internal | Unauthenticated by default. |


## Choosing a database

FlowCMS officially supports four engines. The image is identical for all of
them — the database is runtime configuration, not a build variant.

| Engine | Version verified (Phase 5) | Topology |
|---|---|---|
| SQLite | bundled (libsql) | default, no extra service |
| PostgreSQL | 17 | `-f compose.postgres.yml` |
| MySQL | 8.4 | `-f compose.mysql.yml` |
| MariaDB | 11.4 | `-f compose.mariadb.yml` |

Two variables select it:

```bash
DATABASE_DIALECT=sqlite      DATABASE_URL=file:/data/app.db
DATABASE_DIALECT=postgresql  DATABASE_URL=postgresql://user:pass@postgres:5432/flowcms
DATABASE_DIALECT=mysql       DATABASE_URL=mysql://user:pass@mysql:3306/flowcms
DATABASE_DIALECT=mariadb     DATABASE_URL=mysql://user:pass@mariadb:3306/flowcms
```

The dialect is explicit rather than inferred, because MySQL and MariaDB share
the `mysql://` scheme while being separately supported and separately tested.
A contradictory pair — `postgresql` with a `file:` URL — is refused at startup
rather than resolved:

```
Migration failed: Invalid database configuration: DATABASE_DIALECT is
"postgresql" but DATABASE_URL uses "file://". Refusing to guess which one you
meant.
```

The password is redacted from every log line and error
(`postgresql://flowcms:***@postgres:5432/flowcms`). Migrations for the selected
dialect run automatically at container start, after a bounded connection retry.

### SQLite (default)

```bash
docker compose up -d
```

App plus Garage. The database is a file on the `flowcms-data` volume — no
database server and no extra configuration.

### PostgreSQL

```bash
# .env: POSTGRES_PASSWORD=…   (POSTGRES_USER / POSTGRES_DB default to flowcms)
docker compose -f compose.yml -f compose.postgres.yml up -d
```

### MySQL

```bash
# .env: MYSQL_PASSWORD=…  MYSQL_ROOT_PASSWORD=…
docker compose -f compose.yml -f compose.mysql.yml up -d
```

Created with `--character-set-server=utf8mb4` and
`--collation-server=utf8mb4_0900_ai_ci`. Never the legacy three-byte `utf8`,
which cannot store emoji or much of CJK.

### MariaDB

```bash
# .env: MARIADB_PASSWORD=…  MARIADB_ROOT_PASSWORD=…
docker compose -f compose.yml -f compose.mariadb.yml up -d
```

Created with `utf8mb4` and `utf8mb4_uca1400_ai_ci`. MariaDB is a separate
service with its own volume — not an alias of the MySQL topology pointed at a
different image — and is verified independently end to end.

### Combining with storage and cache

Database choice is independent of everything else:

```bash
docker compose -f compose.yml -f compose.postgres.yml -f compose.external-s3.yml up -d
docker compose -f compose.yml -f compose.mysql.yml --profile redis up -d
```

Database ports are never published to the host; the application reaches them
over the Docker network.

## Identity and collation

MySQL and MariaDB default to case-insensitive collation; PostgreSQL and SQLite
compare case-sensitively. FlowCMS does not let that decide product behaviour:

- **Email is normalised to lowercase in the application** before it is stored or
  looked up, so `User@example.com` and `user@example.com` are one account on
  every engine. Left to collation, one install would allow two such accounts and
  another would not — and the login lookup would fail to find an account its own
  signup had just created.
- **Slugs and page paths are validated, not normalised.** The shared schema
  accepts lowercase letters, digits and hyphens only, so `My-Post` is rejected
  outright rather than silently rewritten. Rejection behaves identically on
  case-sensitive and case-insensitive engines.

Server collation is therefore a performance characteristic, not a behavioural
one.

## Creating the first owner

**No account is created automatically.** `docker compose up -d` gives you a
running CMS with no users; creating the first one is a deliberate act, because
software that ships with a default owner ships with a default way in.

```bash
docker compose run --rm \
  -e FLOWCMS_OWNER_EMAIL=you@example.com \
  -e FLOWCMS_OWNER_PASSWORD='choose-a-long-unique-password' \
  -e FLOWCMS_OWNER_NAME='Your Name' \
  --entrypoint node app scripts/bootstrap-owner.mjs
```

Behaviour:

- the password must be at least 12 characters;
- the account is created with role `owner`;
- it runs **only on an empty installation** — if any user already exists it
  refuses, rather than creating a second owner or promoting an existing account;
- the password is hashed with bcrypt (cost 12), never logged, and never included
  in an error;
- it exits non-zero on failure.

Create further accounts from the admin panel. There is no default account and no
default password anywhere in FlowCMS.

For the same reason, `bun run db:seed` is **development sample data only** — it
is not a production bootstrap path and is not part of the image.

## Backups

Each engine keeps its data in a named Docker volume. `docker compose down -v`
removes those volumes and is the only command here that destroys content.

- **SQLite** — back up the `flowcms-data` volume, ideally with the app stopped
  so the file is not captured mid-write.
- **PostgreSQL** — `docker compose exec postgres pg_dump -U flowcms flowcms`
- **MySQL** — `docker compose exec mysql mysqldump -u flowcms -p flowcms`
- **MariaDB** — `docker compose exec mariadb mariadb-dump -u flowcms -p flowcms`
- **Garage** — `garage-data` and `garage-meta` are separate volumes needing
  their own backup. The database only references objects that live there, so a
  database backup alone restores posts whose images are gone.

## Known limitations

- **Four databases are supported, and each was verified in Phase 5:** SQLite,
  PostgreSQL 17, MySQL 8.4 and MariaDB 11.4 — for migrations, semantic contract,
  first-owner bootstrap, runtime readiness, and persistence across restart and
  `down`/`up`. **That pass is historical.** The database matrix has not been
  re-run since, and the Phase 8 final verification is where it is re-established
  against the current tree.
- **The development seed (`bun run db:seed`) still requires Bun.** It is sample
  data for a developer machine only, and not a production path; the first-owner
  route above is `scripts/bootstrap-owner.mjs`, plain Node, and runs inside the
  image.
- **Single-node Garage.** No replication. Back up the volumes.
