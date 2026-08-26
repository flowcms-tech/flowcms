# First-run setup

How a freshly deployed FlowCMS becomes an installed one, and what that
deliberately does not include.

---

## The line this feature does not cross

FlowCMS separates two things that look similar and are not:

| | Deployment configuration | CMS initialization |
|---|---|---|
| **What** | `DATABASE_DIALECT`, `DATABASE_URL`, `S3_*`, `FLOWCMS_ADMIN_PATH`, `REDIS_URL`, `AUTH_SECRET`, `CAPTCHA_SECRET`, `PREVIEW_SECRET`, `FLOWCMS_SETUP_TOKEN` | The first owner account, the site name and tagline, and the durable "this installation is initialized" marker |
| **Where** | Environment | Database |
| **When** | Before the process boots | Once, through a web form or the CLI |
| **Editable from the web?** | **No** | Yes, once |

**First-run setup is not a web `.env` editor.** It reads deployment
configuration to tell you whether it works. It never writes it. There is no
field for a database URL, an S3 credential, an admin path or a server secret,
and the request schema rejects unknown keys rather than ignoring them.

The `create-flowcms` scaffolder generates the deployment configuration before
the application starts. It **exists in this repository**
(`packages/create-flowcms`) and is **not published** — `npx create-flowcms` does
not resolve today, and no document should imply it does.

**The line above still holds either way.** `create-flowcms` writes deployment
configuration — a `.env`, a Dockerfile, a Compose file — and nothing else. It
creates **no owner account, no site content and no database rows**, and it does
not mark an installation initialized. `/setup` (or `db:bootstrap-owner`) still
owns CMS initialization, and nothing in this document depends on the scaffolder
having been used: a hand-written `.env` reaches exactly the same place.

### What the installer generates

`create-flowcms` generates each of these from a **cryptographically secure**
source — 32 random bytes, base64url, in `packages/create-flowcms/src/secrets.mjs`
(`generateDeploymentSecret`). It must never ship a default, a constant, or a
value derived from the project name, the hostname, or the time:

| Variable | Consequence of a weak or shared value |
|---|---|
| `AUTH_SECRET` | Session tokens can be forged; anyone becomes any user. **The same value must reach every replica** — FlowCMS never generates one at runtime, because per-process keys would mean a session minted by one instance is rejected by the next, and every restart would sign everyone out. |
| `CAPTCHA_SECRET` | An attacker can mint their own valid CAPTCHA challenge, removing the login CAPTCHA rather than weakening it. **Required** — without it nobody can sign in at all. |
| `FLOWCMS_SETUP_TOKEN` | A stranger completes first-run setup and owns the installation. |
| `PREVIEW_SECRET` | Draft previews become forgeable. Optional; omitting it disables the feature. |

FlowCMS refuses the placeholders `.env.example` ships for the required ones, so
an installer that copies the example file without substituting real values
produces a deployment that reports itself not-ready rather than one that looks
fine and is not.

---

## The two ways to initialize an installation

Both create exactly one owner, both close first-run setup permanently, and both
enforce the same rules. Pick whichever suits how you deploy.

### Web setup — `/setup`

For an operator who has a browser and a deployment token.

1. Set `FLOWCMS_SETUP_TOKEN` in the environment and start the container.
2. Open the site. The root redirects to `/setup` while the installation is
   uninitialized.
3. Confirm the system checks are green, fill in the site name and the owner
   account, paste the setup token, submit.
4. Sign in at the link the success screen gives you.

### CLI bootstrap — `scripts/bootstrap-owner.mjs`

For an operator who has a shell on the server, and for automation. It needs no
setup token, because shell access already is the authorization.

```sh
FLOWCMS_OWNER_EMAIL=you@example.com \
FLOWCMS_OWNER_PASSWORD='a long random password' \
FLOWCMS_OWNER_NAME='Your Name' \
  node scripts/bootstrap-owner.mjs
```

It refuses if any user exists, refuses if the installation has already been
initialized, and writes the owner and the marker in one transaction.

**It takes no site-identity input.** It is an owner primitive: a site name
passed on the command line of a bootstrap script is a value nobody revisits.
Site name and tagline stay at their defaults until you edit them in
**Settings → Global** after signing in.

### They cannot both create a "first owner"

| You did this | Then this happens |
|---|---|
| Completed web setup | `bootstrap-owner.mjs` refuses |
| Ran `bootstrap-owner.mjs` | `/setup` and `/api/setup` return 404 |
| Deleted every user afterwards | Both still refuse — the marker is durable |

---

## The setup token

`FLOWCMS_SETUP_TOKEN` is a deployment secret. Generate one:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

- **At least 24 characters, at least 8 distinct characters.** No complexity
  rule: a random 32-byte token is stronger than anything upper/lower/digit/symbol
  requirements would force, and rejecting one for lacking a symbol would push
  you toward something memorable.
- **No default, and no fallback.** Unset means web setup is *locked*, not
  *open* — the page says so and points at the CLI. The application still boots.
- **Never stored, never logged, never echoed, never in a URL.** It is not
  written to the database in any form: the environment is the authority for
  exactly as long as setup is open, and afterwards the endpoint is gone.
- **Compared in constant time**, after hashing both sides to equal-length
  digests so the comparison itself cannot leak the token's length.
- **Obvious placeholders are refused.** `changeme` and friends fail the policy
  and web setup returns a configuration error rather than pretending to be
  protected.

Once setup is complete the variable does nothing. Removing it is safe.

---

## The session-signing secret

`AUTH_SECRET` signs and encrypts every session token. Generate it the same way:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
openssl rand -base64 32
```

Unlike the setup token, this one matters for the whole life of the
installation, not just the first few minutes.

**Rotating it signs everyone out.** That is normal, and it is the price of
changing a signing key: every token issued under the old one stops being
accepted the moment the new one takes effect. FlowCMS deliberately has **no
keyring and no previous-secret support** — a rotation that kept old sessions
valid would keep the compromised key valid too, which is the opposite of why
you would rotate.

**Every replica needs the same value.** FlowCMS never generates one at runtime,
and that is deliberate twice over: per-process keys would mean a session minted
by one instance is rejected by the next, and every restart would sign everyone
out.

### If you are upgrading and your secret is weak

An installation that has been running with `replace-me-with-32-random-bytes-base64`
— or anything else copied out of the example file — is signing sessions with a
key published in this repository.

After upgrading:

- `/api/ready` reports `auth: "unsafe"` and the container is **not ready**;
- the public site keeps serving readers;
- admin authentication stops working rather than silently continuing on a
  repository-known key.

**Replace `AUTH_SECRET` and restart.** Everyone is signed out. That is the
intended outcome, and it is safer than any alternative.

---

## Prerequisites

| Check | Required to complete setup? | Why |
|---|---|---|
| Database | **Yes** | Reachable *and* migrated. |
| Storage (S3-compatible) | **Yes** | FlowCMS has no local media backend. |
| Login security (`CAPTCHA_SECRET`) | **Yes** | Without it nobody can sign in afterwards. |
| Authentication security (`AUTH_SECRET`) | **Yes** | Without a strong one, anyone can sign in as anyone. |
| Redis | No — never checked | Optional everywhere in FlowCMS, and it stays optional here. |

`AUTH_SECRET` is required for the sharper reason. A weak or example value does
not stop you signing in — it lets anyone who can read that value forge a session
as you. Completing setup in that state produces an installation that looks
correct, has a permanently closed setup form, and is owned by whoever wants it.
The placeholder `.env.example` ships is published in this repository and is
refused.

`CAPTCHA_SECRET` is required because **setup may only complete on a deployment
that will actually let you log in.** The login CAPTCHA cannot be issued or
verified without it, and completion closes first-run setup permanently — so an
installation initialized without it would be one nobody could ever administer,
with no supported way to reopen the form. It is deployment configuration and the
setup page never asks for it; it appears as a system check, reported as a state,
alongside database and storage.

Storage is required because marking an installation complete while its only
supported media backend is unusable hands you an admin panel where the File
Manager, the editor's image picker and every upload fail — at exactly the moment
the configuration was easiest to fix.

The storage check is a real round-trip through FlowCMS's own `StorageService`:
it writes a small object under `.flowcms-setup-check/`, reads it back, and
deletes it. A `HeadBucket` would not do — a credential that can list but not
write passes that and fails every upload you ever make.

The setup page reports **states only** — `Ready`, `Unavailable`,
`Not configured`, `Migrations pending`. It is an unauthenticated page, so it
carries no hostname, bucket, endpoint, credential or exception text. The detail
is in the server log, redacted.

---

## Setup closes permanently

Completion writes `settings.setupCompletedAt`. After that:

- `/setup` returns **404**, not an "already installed" page. A page that answers
  forever is a permanent public confirmation of what this software is, and an
  invitation to keep probing.
- `GET` and `POST /api/setup` return **404** as well.
- A valid setup token does **not** reopen it. Neither does deleting every user.
- A repeated `POST` creates no second owner, rewrites no settings, does not move
  the completion timestamp, and never reports success.

The marker is the authority for status. The user count is a *precondition of the
mutation* — "create the first owner" is meaningless when one exists — checked
inside the transaction alongside the marker.

### Concurrency

Two people submitting the form at the same moment with different email addresses
produce exactly one owner. The unique index on `user.email` cannot decide that,
so the singleton marker does: the completion transaction claims it with

```sql
UPDATE settings SET setupCompletedAt = ?
 WHERE id = 'global' AND setupCompletedAt IS NULL
```

and the loser gets a deterministic "already completed" conflict. On a genuinely
fresh installation there is no settings row yet, and then the primary key on the
row being inserted is the guard instead.

Everything is one transaction: owner, site identity and marker commit together
or not at all. A failure part-way leaves nothing behind and setup stays open.

---

## Upgrading an existing installation

**An installation that already has users will not reopen setup.** Migration
`0004_setup_marker` backfills `setupCompletedAt` for any database that had a
user when it upgraded, including one bootstrapped from the CLI that never opened
the settings screen and therefore has no settings row at all.

| At upgrade time | Result |
|---|---|
| Users exist | Setup **closed** |
| No users | Setup **open** — correctly, it is a fresh installation |

The backfill writes the marker and nothing else. It does not invent a site name,
touch the active theme, or modify any other setting.

---

## Routing

| Path | Uninitialized | Initialized |
|---|---|---|
| `/` | redirects to `/setup` | renders normally |
| `/setup` | the form | 404 |
| `/api/setup` | answers | 404 |
| `/api/health` | 200, unchanged | 200 |
| `/api/ready` | 200 when the database is healthy | 200 |
| `robots.txt`, sitemaps, RSS, other `/api/*` | unchanged | unchanged |
| Admin login | renders, with a link to `/setup` | renders normally |

Only the site root redirects, and only because it is the HTML entry point. An
XML client asking for a sitemap must not receive an HTML form, and an
orchestrator polling readiness must not be redirected instead of answered.

`/setup` is a **fixed public path** and is deliberately not governed by
`FLOWCMS_ADMIN_PATH`: there is no authenticated panel yet for the admin path to
protect, and the installer needs one deterministic URL to print — which
`create-flowcms` does, in its generated README and its closing instructions.

No database access was added to `src/proxy.ts`. The redirect lives in the root
page's server component, which already reads settings through the same cached
row — the proxy runs on nearly every request and must stay cheap.

---

## Readiness

`/api/ready` reports first-run state and does **not** gate on it:

```json
{ "status": "ready", "database": "ok", "storage": "connected", "setup": "incomplete" }
```

An operator part-way through first-run configuration has a healthy container,
not a failing one — gating here would have the orchestrator restart the
container while they were using the page that fixes it. `setup` is `"unknown"`
when the database cannot be read, because guessing `"incomplete"` during an
outage would show a live production site as a fresh install.

Nothing about the setup token appears in the payload.

---

## What setup deliberately does not do

No sample post, page, menu, media or business record. No theme installed or
activated — `activeTheme` stays null, which already means "the default theme".
No menus, no theme settings, no SMTP, no analytics, no SEO integrations, no
business profile wizard.

A new FlowCMS installation is clean, and everything above is a decision its
owner makes afterwards, in the admin panel, with the site in front of them.
