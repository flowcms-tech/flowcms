# Continuous integration

FlowCMS's pipeline is six GitHub Actions workflows arranged in three tiers.
The tiers exist because the gates cost wildly different amounts and answer
wildly different questions, and running all of them on every pull request is how
a pipeline becomes something people route around.

> **Read this as "what is configured to run".** The push workflows have run
> green on the public repository; the release gates have not, because nothing
> has been released. The [First-run checklist](#first-run-checklist) lists what
> to expect when a gate runs for the first time.

---

## The three tiers at a glance

| Tier | Trigger | Workflows | Roughly |
|---|---|---|---|
| **Pull request** | every PR, every push to `main` | `ci.yml`, `portability.yml`'s `unit` matrix (+ `docker.yml` when a Docker-relevant file changed) | minutes |
| **Main** | push to `main`, nightly | `docker.yml`, `database-matrix.yml`, `consumer-proofs.yml`, `portability.yml` | tens of minutes |
| **Release** | version tag, manual dispatch | `release.yml`, which calls all five of the above | the lot, plus the compose topology matrix and the package-manager matrix |

### Depth is an input, never the caller's event

Four of these workflows carry a boolean input — `topology` on
`database-matrix.yml`, `full` on the other three — that turns their expensive
legs on. **Those legs must never be gated on `github.event_name` instead.**
Inside a called workflow the event context belongs to the *caller*: a release
cut from a `v*` tag reports `github.event_name == 'push'`, so a job written as
`if: github.event_name != 'push'` skips itself during the one run that must skip
nothing — and reports green while doing it. `release.yml` passes each input
explicitly, and `tests/ci/workflowPolicy.test.ts` fails on a job that reads the
caller's event.

---

## Pull-request gates — `ci.yml`

Four jobs, four different reasons to fail, plus a `gate` job that aggregates
them into the single check worth naming in branch protection.

| Job | What it runs | Why |
|---|---|---|
| `lockfile` | `node scripts/ci/assert-linux-lockfile.mjs` | Eight seconds, no install. npm prunes platform-optional dependencies to the OS that generated the lockfile, so a Windows or macOS `npm install` produces a lockfile that omits `lightningcss-linux-x64-gnu` and friends. Without this gate the first evidence is the Docker image build dying inside Tailwind, minutes in, with a message about a missing native module that says nothing about lockfiles. |
| `static` | `npm run build:packages`, `npm run typecheck`, `npm run lint` | `flowcms/theme` is a real package subpath resolved through `node_modules`, not a tsconfig alias, so its declarations do not exist until the package is built — `tsc --noEmit` cannot resolve a single theme import without it. `next lint` is removed in Next 16 and `next build` no longer lints, so eslint runs directly. |
| `test` | `npm test` | Which is `build:packages && build:template && vitest run`. The builds are not incidental: `tests/packaging` reads `packages/flowcms/dist` and `tests/scaffolder` reads the generated template, and both refuse to skip when the artefact is missing. |
| `artifacts` | `node scripts/verify-artifact-hygiene.mjs` | Would `npm publish` leak anything? See [Artifact hygiene](#artifact-hygiene). |

**No database service.** `tests/db/contract.test.ts` runs SQLite in a temp file
unconditionally and adds an engine only when its `TEST_*_URL` is set, so the PR
tier already covers the default topology at zero cost.

**One more pull-request job lives elsewhere.** `portability.yml`'s `unit` matrix
runs the same `npm test` on Windows and macOS on every pull request; the rest of
that file is main-tier. See [`portability.yml`](#portabilityyml--windows-macos-and-the-other-three-package-managers).

**No Docker, usually.** `docker.yml` carries a `paths:` filter and runs on a
pull request only when the `Dockerfile`, `docker/`, a compose file,
`next.config.ts`, the lockfile or one of the entrypoint scripts changed. A
container build is minutes; paying it on a blog-post typo is not a gate, it is a
tax.

### Running the PR tier locally

```bash
node scripts/ci/assert-linux-lockfile.mjs
npm ci
npm run build:packages
npm run typecheck
npm run lint
npm test
npm run build:template
node scripts/verify-artifact-hygiene.mjs
```

---

## Main gates

Everything below runs on a push to `main` and again nightly. None of it blocks a
pull request.

### `docker.yml` — the image

`image` builds the repository's own `Dockerfile` and then **runs** it. A build
that succeeds and a container that serves nothing but 500s are not the same
result: Phase 3 established that this application can bind its port while
failing every request, which is why `/api/ready` exists and why the Docker
`HEALTHCHECK` is an HTTP probe rather than a port check. The job asserts that
the container becomes ready, that `/api/health` and `/api/ready` both answer,
that migrations ran from the entrypoint, that readiness leaks no connection
detail, and that no configured secret reached the container log.

Storage is deliberately left unconfigured. Readiness **reports** storage and
never gates on it — a fresh install has no bucket yet — and this run is the
cheapest place to keep that promise honest.

`generated-image` runs `scripts/verify-create-flowcms.mjs` in full, including
the `docker build` whose context is a project generated **outside** this
repository by the packed `create-flowcms`. Nightly, manual and release only.

**Nothing in this pipeline pushes an image.** There is no registry login, no
credential and no `docker push`; the images die with the runner. Publishing an
image is a release decision and it is not made in CI.

### `database-matrix.yml` — four engines, two depths

FlowCMS supports SQLite, PostgreSQL 17, MySQL 8.4 and MariaDB 11.4.

**Contract level** (`contract-postgresql`, `contract-mysql`, `contract-mariadb`)
runs the parameterised suite in `tests/db` against a real server started as a
GitHub Actions `services:` container, after `node scripts/migrate.mjs` — the
suite's own comment says it: *"Remote engines are migrated by the harness that
starts them."* This job is that harness.

**Topology level** (`topology`) runs `scripts/db-matrix.sh` against the actual
compose overlay: cold start from empty volumes, migrations at container start,
first-owner bootstrap, duplicate bootstrap refused, a marker row written through
the application's own database layer and still present after a container restart
and a `down`/`up`. Four engines, four image builds. Off by default; on nightly,
on manual dispatch with `topology: true`, and mandatory in the release tier.

#### Why both, and why `services:` for one and Compose for the other

They answer different questions and neither substitutes for the other.

`services:` gives a bare server on loopback. That is all the contract suite
needs — it asks *does the application's data layer behave identically on this
engine?* — and it is much cheaper, because it skips the image build entirely.

The compose overlays are the artefact an operator actually runs. They carry the
healthchecks, the named volumes, the `depends_on: service_healthy` ordering, the
charset flags and the `:?` guards that refuse to start without a credential.
None of that can be expressed in a `services:` block, and all of it is what
breaks in the field. That level asks *does a real deployment of this topology
survive being operated?*

#### MariaDB is independent, in both levels

Its own job, its own image, its own credentials, its own `TEST_MARIADB_URL`, its
own compose overlay and its own volume. It shares a driver and a URL scheme with
MySQL and it is a different product; Phase 5 found a real bug that presented as
"MySQL passes, MariaDB fails". Running MySQL twice and labelling one of them
MariaDB would have hidden exactly that, while reporting four engines verified.

`tests/ci/workflowPolicy.test.ts` fails if the two jobs ever collapse into one.

### `consumer-proofs.yml` — does what we ship work for a stranger?

`ci.yml` proves the repository is healthy. That is a different claim from "what
the repository produces is usable", and inside a monorepo the first one passes
for reasons that have nothing to do with the second: `flowcms` and the example
theme resolve through `file:` links, which expose the whole source directory, so
every `files` mistake, every missing export and every unpublished file works
anyway.

| Job | What it proves |
|---|---|
| `package-consumer` | `scripts/verify-package-consumer.mjs` packs `flowcms` and the Aurora theme, installs the **tarballs** into a throwaway directory outside this repository, then typechecks, executes and renders from there. Only an installed tarball has the shape a stranger gets. |
| `generated-project` | `scripts/verify-create-flowcms.mjs --no-docker` packs `create-flowcms`, generates a project outside this repository, and installs, builds, typechecks and lints it. On a push to `main` only — the nightly and release tiers run the same script *with* the image build, as `docker.yml`'s `generated-image`. One script at two depths, not two overlapping proofs. |
| `integration-build` | `FLOWCMS_INTEGRATION_THEMES=1 npm run build`, then `scripts/ci/assert-theme-tracing.mjs`: the installed package theme was traced into `.next/standalone`, and Tailwind read source inside `node_modules`. |

The Tailwind assertion greps the built CSS for `letter-spacing:.4375em`.
**The leading zero is missing on purpose.** The minifier drops it. Phase 7
grepped for `0.4375em`, found nothing, and concluded across four builds and a
written design decision that Turbopack ignores `@source`. It does not. That is
why the marker lives in a script with the reason attached rather than being
retyped from memory into a workflow file.

### `portability.yml` — Windows, macOS, and the other three package managers

Every other workflow runs on Linux with npm, because that is what the Docker
image is and what production runs. This one exists for the two populations that
touch neither: contributors on Windows and macOS, and operators who scaffold a
project with pnpm, yarn or bun. It implements the matrix Phase 8.4 designed and
deliberately left unwritten.

| Job | Runners | Tier | What it proves |
|---|---|---|---|
| `unit` | `windows-2022`, `macos-14` | pull request | `npm ci` then `npm test` — which builds both packages and the template first. A path separator, a case-insensitive filesystem or a CRLF checkout shows up here |
| `scaffold` | `windows-2022`, `macos-14` | main + nightly + release | `node scripts/verify-create-flowcms.mjs --no-docker` — pack, install the tarball outside the repository, run the installed bin, scaffold, install, build, typecheck, lint |
| `package-managers` | `ubuntu-24.04` | nightly + release | `node scripts/verify-package-manager-matrix.mjs --managers pnpm,yarn,bun` — install the packed CLI, link the bin, forward arguments, scaffold, write exactly one lockfile, build, and build an image, once per manager |

**Ubuntu is not in the OS matrix.** `ci.yml`'s `test` job is the Linux leg and
already runs on every pull request. Repeating it here would pay for
`build:packages`, `build:template` and the whole suite twice per PR to learn the
same thing.

**One OS for the manager matrix.** A package manager's behaviour differs far
more between *managers* than between operating systems, and Docker only runs on
Linux runners. A 4×3 manager × OS grid would roughly quadruple the cost to
re-prove the same manager differences three times. Windows and macOS runners
also cost several times a Linux one.

**The lockfile is never regenerated.** `package-lock.json` must stay the
Linux-generated one — `ci.yml`'s `lockfile` job enforces that and the image build
depends on it. The Windows and macOS jobs install *from* it, and `npm ci` cannot
rewrite it, which is the other half of why this pipeline never runs the other
verb.

**A deliberate deviation from the 8.4 design,** recorded so it is not mistaken
for an oversight: 8.4 put the scaffold smoke on every pull request. It is an
install, a production Next build, a typecheck and a lint of a generated project
on the two slowest runner classes GitHub offers — a main-tier cost. The cheap
`unit` matrix is the part that gates a pull request.

**This job is what turns "supported" into "verified."**
`docs/distribution/package-managers.md` records pnpm and bun as *Supported* and
yarn as *Experimental* precisely because nothing has ever run them. A manager
missing from the runner is reported **SKIPPED with a reason**, never passed, so a
broken install step degrades the result honestly rather than inventing evidence.

### Running the main tier locally

```bash
node scripts/verify-package-consumer.mjs
node scripts/verify-create-flowcms.mjs            # add --no-docker to skip the image
FLOWCMS_INTEGRATION_THEMES=1 npm run build && node scripts/ci/assert-theme-tracing.mjs

docker build -t flowcms:local .
cp .env.example .env    # then generate real values — the placeholders are refused
bash scripts/db-matrix.sh sqlite
bash scripts/db-matrix.sh postgres
bash scripts/db-matrix.sh mysql
bash scripts/db-matrix.sh mariadb

# portability — the manager matrix needs pnpm, yarn and bun on PATH
node scripts/verify-package-manager-matrix.mjs --managers pnpm,yarn,bun --no-docker
```

---

## Release gates — `release.yml`

Triggered by a `v*` tag **push** or a manual dispatch — a tag created locally
triggers nothing, so creating the tag and pushing it are separate steps. It **calls** `ci.yml`,
`database-matrix.yml` (with `topology: true`), `consumer-proofs.yml`,
`docker.yml` and `portability.yml` (the last three with `full: true`) as
reusable workflows rather than copying their job lists, so a gate cannot pass on
`main` and be quietly absent from a release.

It then asserts that the two publish targets are guarded and publishable while
the packages that must never be published are still private, and writes a
summary saying the proof published nothing.

The `publish` job opens with `RELEASE_PRECONDITIONS`, unconditional and first.
It asserts the two *ordering* facts a green pipeline cannot tell you about: the
repository is public, and both manifests carry `repository`. It fails
closed on a visibility it cannot read. Removing it removes
the only automated memory of why the publication order is what it is.

### The release-proof plan, printed beside the tiers

`scripts/release-proof.mjs` (Phase 8.5) is the canonical, ordered list of what a
release must prove: build → test → package → inspect → clean install → create
project → release dry-run. `release.yml` **prints its plan and does not execute
it.** Plan mode is the script's default, runs nothing and exits 0.

That is deliberate. The stages have already run, in parallel, as the tiers
above; re-running the orchestrator serially would pay for all of it a second
time across tens of minutes and would hide five readable job results behind one
long log. Printing the plan into the run summary is what keeps the two from
drifting: a stage added to the script but not to a tier shows up in every
release summary with nothing beside it.

To run the orchestrator itself — locally, deliberately, never from CI:

```bash
node scripts/release-proof.mjs                  # plan only; runs nothing
node scripts/release-proof.mjs --execute
node scripts/release-proof.mjs --execute --with-docker
```

`release.yml` deliberately contains no changelog logic, no version bumping and
no tagging; the human release process is maintained separately by the
maintainers.

### npm provenance

The blocked `publish` job declares `id-token: write`, which is what
`npm publish --provenance` needs. **That is a declaration, not evidence.**
Provenance additionally requires the repository to be public, the manifest to
carry a correct `repository` field, and the publish job to have actually run.
The first two now hold; the third does not, because nothing has been published.

**The public-repository requirement is an ordering constraint on the release,
not a detail of the flag.** A provenance publish from a private repository is
expected to be refused rather than downgraded, so the repository is made public
*before* anything is published — not afterwards. That ordering is what
`RELEASE_PRECONDITIONS` asserts. If provenance is dropped and the
publish is done interactively instead, the claim is dropped with it.

Nothing anywhere should claim provenance until an attestation is visible on the
package page and resolves to a workflow run.

### Not built: a licence-compliance job

Phase 8.2 records a transitive dependency-licence scan as a pre-publication
requirement. **No such job exists**, and it was not added here for two reasons
worth writing down rather than rediscovering. It needs a scanner this repository
does not depend on, and adding one means regenerating `package-lock.json` — which
must happen in a Linux container, not on a maintainer's machine, and not from
inside a CI phase. FlowCMS itself is `GPL-2.0-or-later`, but the transitive
dependency scan that would confirm compatibility across the tree has not been
run. The job belongs in the commit that lifts the publish blocks.

---

## Release safety

**Nothing has been published yet.** Publication is possible but deliberately
hard to reach: it takes four independent things lining up, and no ordinary push
or merge can supply any of them.

1. **A manual dispatch of `release.yml`.** A `v*` tag push runs the proof tiers
   and stops there; an ordinary push to `main` does not trigger the file at all.
2. **`publish: true`** on that dispatch.
3. **A typed confirmation phrase** on the same dispatch. A boolean alone is one
   mis-click.
4. **The `npm-publish` GitHub environment**, which is where required reviewers
   belong — the one gate that is a person rather than a file.

Then, per package, `prepublishOnly` → `publish-guard.mjs` validates the licence,
the repository metadata and the built artifacts before npm sends anything. Those
guards refuse by default: a hand-run `npm publish` from a laptop fails, because
only the release job marks a release as being in progress. npm runs them on
`publish` and **not** on `pack`, so every packaging proof still runs unchanged.

The two packages publish in order — `flowcms`, then `create-flowcms` — and the
second does not run if the first fails.

`secrets.NPM_TOKEN` is a bootstrap credential, reachable only by the two publish
steps: never at workflow level, never at job level, never echoed, and never
written to a summary or an artifact.

Reaching `main` publishes nothing. `release.yml` has no branch trigger at all.

---

## Secret policy

**CI requires no production secret, and no repository secret exists.**

`scripts/ci/generate-test-secrets.mjs` generates `AUTH_SECRET`,
`CAPTCHA_SECRET`, `PREVIEW_SECRET` and `FLOWCMS_SETUP_TOKEN` as 32 random bytes
each at the start of the job that needs them, masks them with `::add-mask::`
before printing, and appends them to `$GITHUB_ENV`. They die with the runner.

They are cryptographically random and therefore *valid*, which is the point:
`Framework/Config/deploymentSecret.ts` refuses placeholder-shaped strings by
design, so a workflow exporting `AUTH_SECRET=test` would be exercising the
refusal path rather than the application.

### Which jobs get them — and why the test jobs deliberately do not

**Only the jobs that RUN the application generate secrets:**
`consumer-proofs.yml`'s `integration-build` (a real `next build`) and
`docker.yml`'s `image` (a running container).

The two jobs that run `npm test` — `ci.yml`'s `test` and `portability.yml`'s
`unit` — get **nothing**, and that is a correctness requirement rather than
tidiness. Setting `AUTH_SECRET` makes a suite fail:

`resolveAuthSecret()` returns a snapshot taken at module load
(`CONFIGURED_AT_LOAD` / `VERDICT_AT_LOAD` in
`src/Framework/Auth/authSecretConfig.ts`), so it reflects the environment the
vitest worker *started* with and no `afterEach` can influence it. The last test
in `tests/auth/authSecretLeakage.test.ts` asserts unconditionally that it
returns `undefined` — its comment states that the suite's process has no usable
`AUTH_SECRET`. A generated secret is a valid 44-character random base64 string,
classifies as `usable`, and falsifies that assertion.

Nothing in `npm test` wants the values in any case: every suite that needs one
sets it itself and restores it (`captcha*.test.ts`, `setupRoute.test.ts`,
`authSecret*.test.ts`), the remaining references are text assertions over
`.env.example` and rendered templates, and none of the three build scripts
`npm test` runs reads `process.env` at all.

`tests/ci/workflowPolicy.test.ts` fails if either file gains a
`generate-test-secrets.mjs` step, so the two OS tiers cannot drift apart here.

`scripts/ci/write-ci-env.mjs` does the same job for the compose-based topology
matrix, which cannot use `$GITHUB_ENV`: Compose reads a `.env` **file** from the
project directory before any step's environment exists, and the overlays
interpolate their `:?`-guarded credentials from it. Every value it writes is
random and per-job, and it prints names only.

### The one literal, and why it is not an exception

`database-matrix.yml` hardcodes `ci_local_only_not_a_secret` as the password for
its `services:` databases. GitHub evaluates `services:` **before any step of the
job runs**, so there is no step in which a generated value could reach it.

That string is not a secret: it grants access to a database that exists on one
ephemeral runner, is reachable only on that runner's loopback interface, is
destroyed with it, and is never reused. `tests/ci/workflowPolicy.test.ts` pins
the `not_a_secret` substring so that anyone swapping in something that *looks*
like a credential has to argue with a test first.

---

## GitHub permissions

Every workflow declares `permissions: contents: read` at the top level. No test,
build, database or Docker job in this pipeline can write anything — not a
comment, not a tag, not a package.

The only elevated permissions in the entire pipeline live in `release.yml`'s
blocked `publish` job, scoped to that job:

```yaml
permissions:
  contents: write   # create the GitHub Release
  id-token: write   # npm provenance (OIDC)
```

`tests/ci/workflowPolicy.test.ts` fails if a write permission appears in any
other file, or before the `publish` job inside `release.yml`.

---

## Artifact hygiene

`scripts/verify-artifact-hygiene.mjs` runs `npm pack --dry-run --json` for
`flowcms`, `@example/flowcms-theme-aurora` and `create-flowcms`, and refuses on:

- environment files (`.env`, `.env.local`, `.env.<anything>`)
- database files (`*.db`, `*.db-wal`, `*.sqlite`, `*.sqlite3`)
- local credentials scratch files, `.npmrc`, `.netrc`, and anything named
  `credential*`
- private keys and certificates (`*.pem`, `*.key`, `id_rsa`, `*.p12`, `*.pfx`)
- `.git/`, `node_modules/`, `*.tgz`, `.next/`, `coverage/`, `*.tsbuildinfo`
- `.claude/`, `.cursor/`, `.idea/`, `.vscode/` and other local tooling
- maintainer-only documents: agent briefs, internal planning directories,
  phase and implementation reports, and maintainer notes
- repository tooling (`publish-guard.mjs`, `vitest.config`, `eslint.config`) and
  the test suite
- **absolute build-machine paths embedded in shipped text** — a declaration file
  that says `import("C:/Users/someone/…")` names a directory on the
  maintainer's laptop and resolves nowhere for a consumer
- unresolved `@/…` internal aliases in emitted code

### `.env.example` — a decision, not an oversight

`.env.example` **ships inside `create-flowcms`, and only under `template/`.**

A generated project without it has no documentation for the variables it needs,
and `docs/docker.md` tells the operator to copy it. It carries no values: every
secret in it is a placeholder the application refuses at startup, deliberately.
It is documentation shaped like a config file.

`flowcms` and the Aurora theme are libraries. Neither has any use for one, so
for those two `.env.example` is treated exactly like `.env`.

### Two rules the script never breaks

1. **It reports names, never contents.** A leak gate that prints the secret it
   found has republished the secret into the CI log, where it is more durable
   and more widely read than the file was. The content scan is skipped entirely
   for any file a name rule already caught — which is why the local credentials
   file is matched by name in the deny list and is never opened.
2. **The deny list sits under an allowlist.** A stray fails because it is not on
   the package's `files` allowlist; the deny rules exist to say *why* a
   particular class of stray is dangerous, in a message a maintainer can act on.
   A deny list on its own is a denial of the things somebody remembered.

### Why this duplicates the consumer proof

`scripts/verify-package-consumer.mjs` also audits tarball contents. That overlap
is deliberate. The consumer proof builds, packs, installs, typechecks and
renders — minutes of work, so it runs on `main` and on a release. This runs in
seconds against `--dry-run` output, so it runs on every pull request. A hygiene
rule that only runs before a release is a rule that finds its first violation at
the worst possible moment.

The gate **refuses to run against an unbuilt package** rather than skipping.
Reporting "clean" for an artefact that does not exist is a green check mark
attached to nothing.

---

## Supply chain

Practical for v0.1, not an enterprise programme.

- **`npm ci`, never `npm install`.** `npm ci` installs exactly what the lockfile
  pins and exits non-zero when `package.json` and the lockfile disagree.
  `npm install` would quietly rewrite the lockfile and pass.
- **Action pinning: major version tags** (`actions/checkout@v5`,
  `actions/setup-node@v5`). Major tags, not SHAs, is a conscious v0.1 trade: SHA
  pinning removes tag-repoint risk and adds a manual bump for every security
  patch, which for a two-action pipeline maintained by one person is more likely
  to rot than to protect. `tests/ci/workflowPolicy.test.ts` enforces that
  *something* is pinned and that nothing tracks `@main`, `@master` or `@latest`.
  Revisit when the project has more than one regular maintainer.
- **Three actions total, and two of them are first-party.**
  `actions/checkout` and `actions/setup-node` do almost everything. No
  third-party Docker build action, no path-filter action, no artifact upload —
  the `paths:` filter is native and the Docker build is plain `docker build`.
  Each avoided action is one less thing that can be compromised. The cost is no
  registry layer cache for the image build, which is accepted.
- **The one third-party action is `oven-sh/setup-bun`,** in
  `portability.yml`'s manager matrix, and the reason is narrow. pnpm and yarn
  come from **corepack**, which ships with Node and fetches from the npm
  registry — no action and no piped download. bun is not corepack-managed and
  its documented installer is `curl … | bash`, which this pipeline refuses on
  principle and a test pins. A vendor-published, major-pinned action is the
  smaller of the two risks. If it is ever removed, the matrix script reports bun
  as SKIPPED with a reason rather than passing silently: losing the action costs
  coverage, never correctness.
  `bun-version: latest` is deliberate — the question that job asks is whether
  the *current* bun works, and pinning would answer it about a stale one.
- **No `curl | sh`.** Nothing in the pipeline downloads and executes a remote
  script. Pinned by a test.
- **`COREPACK_ENABLE_DOWNLOAD_PROMPT: "0"`** wherever corepack runs. Corepack
  asks for confirmation before its first download, and a prompt on a runner with
  no stdin is a hang, not a question.
- **Pinned runner images** (`ubuntu-24.04`, not `ubuntu-latest`), so a runner
  image rollover is a deliberate bump rather than a Tuesday morning surprise.
- **Node 22 only.** `engines.node` is `>=22`, the Docker image is
  `node:22-bookworm-slim`, and generated projects require the same. A version
  matrix here would test combinations nothing ships on. Pinned by a test.

### Dependency caching

`actions/setup-node`'s `cache: npm` caches `~/.npm` — the **download** cache,
not `node_modules`. `npm ci` still deletes and rebuilds `node_modules` from the
lockfile on every run, so a dependency missing from the lockfile still fails.
A cache that can hide a missing dependency is worse than no cache; this one
cannot.

---

## Dependencies of the pipeline

| Gate | Needs |
|---|---|
| `ci.yml` | nothing beyond the runner |
| `docker.yml` `image` | Docker on the runner (standard on GitHub-hosted Ubuntu) |
| `docker.yml` `generated-image` | Docker, and several minutes |
| `database-matrix.yml` contract jobs | `postgres:17-bookworm`, `mysql:8.4`, `mariadb:11.4` as service containers |
| `database-matrix.yml` `topology` | Docker Compose, and an ephemeral `.env` |
| `consumer-proofs.yml` | nothing beyond the runner; the scripts pack from `node_modules` and never hit a registry |
| `portability.yml` `unit`, `scaffold` | a Windows and a macOS runner; nothing else |
| `portability.yml` `package-managers` | corepack (ships with Node), the `oven-sh/setup-bun` action, and Docker |

No self-hosted runner, no privileged container, no registry credential, no
external service. `portability.yml`'s manager matrix does reach the npm registry
through corepack and reaches GitHub releases through `setup-bun`; every other
job in the pipeline installs only from the lockfile.

---

## Tests that guard the pipeline itself

| File | What it pins |
|---|---|
| `tests/ci/workflowPolicy.test.ts` | least privilege, action pinning (including runner images inside a matrix), `npm ci`, Node 22, no secret in YAML, MariaDB independence, no `docker push`, depth-as-an-input rather than the caller's event, the portability matrix's shape, and every release block |
| `tests/ci/artifactHygiene.test.ts` | the deny list, the `.env.example` exception, and that violations carry names and rule ids rather than content |

Both run inside `npm test`, so they are pull-request gates like everything else.

---

## First-run checklist

Nothing here has executed. Expect to fix some of the following on the first run,
and treat none of them as evidence the design is wrong:

1. **Action major versions.** `actions/checkout@v5` and `actions/setup-node@v5`
   were written from the majors current at the time. If either tag does not
   resolve, drop it one major — the pinning policy is what matters, not the
   number.
2. **Service container health commands.** `mysqladmin` for MySQL 8.4 and
   `mariadb-admin` for MariaDB 11.4 mirror the compose overlays. If a health
   check never goes green, that command is the first thing to check.
3. **Charset flags.** The `services:` containers cannot take the
   `--character-set-server=utf8mb4` arguments the compose overlays pass, because
   Actions offers no `command:` for a service. The contract jobs therefore run
   on each image's defaults. The topology matrix does exercise the real flags;
   if the two ever disagree, the topology result is the one that describes a
   deployment.
4. **Job durations.** The tiering is reasoned, not measured. If the PR tier is
   slower than it looks on paper, `artifacts` is the job to move to `main`
   first — it is the cheapest to relocate and the least likely to catch a
   regression introduced by the change under review.
5. **Reusable-workflow calls.** `release.yml` calls five local workflows. If a
   called workflow needs a permission the caller does not grant, the failure
   will name it. Check the *skipped* jobs in a release run as carefully as the
   failed ones: a depth input that did not arrive shows up as a green run that
   quietly proved less.
6. **`npm ci` on Windows and macOS.** The lockfile records every platform's
   optional binaries — `@next/swc-win32-x64-msvc`, `lightningcss-darwin-arm64`,
   `@napi-rs/canvas-darwin-arm64`, `@libsql/win32-x64-msvc` are all present — so
   `npm ci` should select each runner's own set without touching the file. This
   was read out of `package-lock.json`, not observed on a runner. If a
   portability job dies in a native module, that assumption is the first thing
   to check, and the fix is *never* to regenerate the lockfile on that OS.
7. **Line endings on the Windows runner.** `.gitattributes` pins LF for what a
   kernel or image build executes. A checkout that predates it, or a test that
   compares file bytes, is the likeliest first Windows failure and says nothing
   about the design.
8. **corepack and bun.** `corepack enable pnpm yarn` and `oven-sh/setup-bun@v2`
   have never run here. If either fails, the manager matrix reports that manager
   SKIPPED rather than failing the job — so read its summary, not just its exit
   status, before recording a support level anywhere.

---

## See also

- `docs/docker.md` — the image, compose topologies, health and readiness
- `docs/distribution/packages.md` — the package model and the release blockers
- `docs/distribution/create-flowcms.md` — the scaffolder and what it generates
- `docs/distribution/package-managers.md` — the support levels `portability.yml`
  exists to move
