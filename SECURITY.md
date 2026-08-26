# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting: open the repository's **Security**
tab and choose **Report a vulnerability**. That creates a draft advisory visible
only to you and the maintainers, with a private fork to develop a fix in and a
CVE request when one is warranted. It is the only reporting channel this project
offers, deliberately — it needs no shared mailbox, it cannot be missed in a spam
folder, and it keeps the report and the fix in one place. GitHub's own
documentation describes the flow in full:
["Privately reporting a security vulnerability"](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability).

> **TODO — maintainers, before this repository is made public:** enable
> *Settings → Code security → Private vulnerability reporting*. Until that
> switch is on, the **Report a vulnerability** button does not exist and this
> section describes a channel that is not open. There is intentionally no email
> address here: publishing one nobody monitors is worse than publishing none.

Please include:

- what the issue is, and what an attacker gains from it;
- the smallest reproduction you have — a URL, a request, a payload;
- affected version or commit;
- your configuration where it matters (database, storage provider, whether
  Redis is configured, whether the CMS sits behind a reverse proxy).

You will get an acknowledgement, and an assessment with a fix timeline or an
explanation of why we do not consider it a vulnerability. FlowCMS is maintained
by a small team, so no response-time guarantee is offered here — one that is not
staffed is not worth writing down. If a report goes unanswered longer than you
think reasonable, say so in the advisory thread rather than disclosing publicly.

Please give us a chance to ship a fix before disclosing. We will credit you in
the advisory unless you ask us not to.

## Supported versions

FlowCMS is pre-1.0 and under active development. Only the latest `main` receives
security fixes; there are no maintained release branches and no backports. If
you run a fork or a generated site created by `create-flowcms`, you own the
merge — a generated project is a copy, not a dependency, so a fix here does not
reach it until you bring it across.

## What is in scope

- Authentication and session handling.
- Authorization: any way for a role to perform an action above its level. See
  `src/Framework/Auth/routePolicies.ts` for the intended policy of every API
  route — a mismatch between that table and actual behaviour is a bug worth
  reporting.
- Injection of any kind: SQL, HTML/XSS, template, header, path.
- SSRF, particularly through the link checker.
- Access to storage objects, cache entries, or database rows that the caller
  should not be able to reach.
- Secrets appearing in responses, logs, or the activity log.

## What is out of scope

- Findings that require an already-compromised owner or admin account. Those
  roles are trusted by design.
- Missing hardening headers on a deployment where the operator has chosen to
  manage them at a reverse proxy (`FLOWCMS_CSP=off` is a supported setting).
- Denial of service through sheer request volume. Rate limiting exists on the
  login and public endpoints; general capacity is a deployment concern.
- Automated scanner output with no demonstrated impact.
- Vulnerabilities in a dependency that FlowCMS does not actually reach. Say
  which code path reaches it.

## Known limitations, stated deliberately

These are documented rather than hidden, because knowing them is what lets an
operator decide whether they matter for their deployment.

**The default Content-Security-Policy is report-only.** Next.js inlines its
hydration scripts and this app has no per-request nonce mechanism, so the
policy has to permit inline script to work at all. Report-only is the default so
that an operator sees what enforcement would break before switching it on with
`FLOWCMS_CSP=enforce`. Clickjacking protection (`frame-ancestors` and
`X-Frame-Options`) is enforced in every mode. See
`src/Framework/Security/securityHeaders.ts`.

**Rate limiting degrades without Redis.** With `REDIS_URL` unset or Redis
unreachable, login throttling falls back to a per-process in-memory counter. It
still limits a single instance, but it does not coordinate across replicas and
it resets on restart. Failing the other way — refusing all logins when the
limiter cannot reach its backend — would turn a Redis outage into a total
lockout of the admin panel, including the account needed to fix it. Configure
Redis for any multi-replica deployment.

**The SSRF guard narrows DNS rebinding rather than eliminating it.** The link
checker resolves and validates a hostname, then `fetch` resolves it again; a
hostile authoritative nameserver can in principle answer differently between the
two. Every redirect hop is re-validated and the window is small, but closing it
completely requires pinning the connection to the validated address, which
Node's `fetch` does not expose. See `src/Framework/Net/ssrfGuard.ts`.

**CLI bootstrap passes a password through the environment.** There are two ways
to create the first owner, and they have different exposure. Browser setup at
`/setup` never puts the password in an environment variable or a process
listing, and is the recommended path; it is gated by `FLOWCMS_SETUP_TOKEN`,
which is a deployment secret and is locked — not open — when unset.
`scripts/bootstrap-owner.mjs` takes `FLOWCMS_OWNER_PASSWORD` from the
environment instead, which exposes it to `docker inspect`, shell history and
process listings on that host. Use it where shell access is already the
authorization, and change the password after signing in if the host is shared.
Both paths refuse to run once the installation is initialized, and the marker
that records that is durable — deleting every user does not reopen setup. See
[`docs/setup/first-run.md`](./docs/setup/first-run.md).

**Integration credentials live in the database.** Google Search Console, Bing
Webmaster Tools, PageSpeed Insights and IndexNow credentials are stored in
settings, not in the environment, so a copy of `data/app.db` — or a database
dump — carries them along with every password hash. Treat a database backup as
a secret in its own right.

## Operator checklist

- Set `AUTH_SECRET`, `CAPTCHA_SECRET`, `PREVIEW_SECRET` and — if you intend to
  use browser setup — `FLOWCMS_SETUP_TOKEN` to independent 32-byte random
  values. Never reuse them between deployments. FlowCMS refuses the placeholder
  values `.env.example` ships, so an install that copied the example without
  substituting real ones reports itself not-ready rather than looking fine.
- Remove `FLOWCMS_SETUP_TOKEN` once setup is complete. It does nothing
  afterwards, and a secret with no remaining purpose is only a liability.
- Serve over HTTPS. `Strict-Transport-Security` is sent in production.
- Configure `REDIS_URL` if you run more than one instance.
- Keep the database file and the S3 bucket out of any published artefact — a
  distributed `data/app.db` contains password hashes and every stored credential.
- Grant the least role that does the job. `contributor` cannot publish;
  `editor` cannot reach settings, integrations, or accounts.
