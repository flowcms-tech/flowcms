# Package managers and platforms

Which package managers and operating systems FlowCMS supports, and what running
FlowCMS under each of them actually involves.

Everything here is stated on two axes, kept deliberately apart:

- **Support tier** — what FlowCMS commits to supporting.
- **Verification** — what has actually been exercised and proven, and where.

They are not the same claim, and this document never merges them into one.

> **The registry invocation forms work.** `create-flowcms` is published, so
> `npx create-flowcms@latest`, `npm create flowcms@latest`,
> `pnpm create flowcms`, `yarn create flowcms` and `bun create flowcms` all
> resolve ([status](../../README.md#project-status)). The support tiers below
> are about what each manager does as the *generated project's* package
> manager, which is a separate question from which one invoked the scaffolder.

## Support tiers, and what verification means

**These are two different questions, and reading them as one is how a support
matrix misleads people.**

- **Support tier** is what FlowCMS commits to: how a manager is treated when it
  breaks, and how much of the surface is expected to work.
- **Verification** is what has actually been executed, on what platform.

A manager can be verified on the matrix and still sit below the top tier —
passing CI on one runner is evidence, not a support commitment.

| Tier | What FlowCMS commits to |
|---|---|
| **Verified / primary** | the manager FlowCMS is developed and released against. The widest platform coverage, and the one a defect is fixed against first |
| **Supported** | a first-class choice with no known blocking defect. Defects are accepted and fixed; coverage is narrower than primary, and the caveats are named below |
| **Experimental** | selectable and expected to work, but with characteristics that make it more likely to surprise you. Use it knowing the caveats below |

Naming a tier is not a courtesy. An operator choosing a package manager is
choosing what their lockfile is and what their image build runs, and they need
to know both what has been run and what is being promised.

**A tier is not upgraded by a green run.** Moving one takes both a run of its
own and a decision to back it; evidence alone is not a promotion.

### Package managers

The verification column records **public GitHub Actions evidence**:
`portability.yml` dispatched with `full: true`, **SUCCESS**, covering all four
managers on `ubuntu-24.04`.

| | Support tier | Verification |
|---|---|---|
| **npm** | **Verified / primary** | Windows + Linux. Full `verify-create-flowcms.mjs` pass including an image build, plus a complete generated-project runtime E2E (setup, login, admin path, restart persistence) |
| **pnpm** | **Supported** | 11.23.0 — verified on the matrix: install, `pnpm-lock.yaml`, `packageManager`, README, `build:packages`, build, typecheck, lint **and a Docker image build**, all green |
| **yarn** | **Supported** — Yarn 1 Classic | 1.22.22 Classic — verified on the matrix, the same complete set with `yarn.lock`. **Berry (2+) is outside the supported range and is untested** — see the PnP caveat below |
| **bun** | **Experimental** | 1.3.14 — verified on the matrix, the same complete set with `bun.lock`, and `packageManager` correctly **omitted** (corepack does not manage bun) |

**All four managers build a generated project end to end, and all four produce a
working Docker image from one.** Matrix result: **39 pass, 0 fail, 5 skip**.

**Passing the matrix did not promote anything.** The matrix runs on
`ubuntu-24.04`, so pnpm, yarn and bun are verified *there*; npm additionally has
a full `verify-create-flowcms.mjs` pass on Windows and the runtime E2E, which is
why it is the primary manager. macOS and Windows are covered for the suite and
the scaffold by the other Portability jobs — all green — but an image build is a
Linux-runner job, so **no** manager has a Docker proof on those platforms.
Bun stays **Experimental** on the strength of the caveats in
[Known risks, by manager](#known-risks-by-manager), not on any missing evidence.

**The 5 skips are the registry invocation forms** — `npx create-flowcms@latest`
and the three `<manager> create flowcms` spellings. Each resolves a name *from a
registry*, and nothing is published yet, so a local tarball cannot stand in.
They were not counted as passes and they are not a gap in manager support.

### The image build's heap ceiling — addressed

Next runs its TypeScript check in a **worker process**. A
`node --max-old-space-size=4096` on the build command raises the heap for the
parent only; the worker does not inherit it and falls back to V8's default,
which is derived from the memory the container can see. On a builder with
modest RAM that default is around 2 GB, and the check can exhaust it.

The Dockerfile therefore sets the limit as an environment variable in the
builder stage, so the workers inherit it:

```dockerfile
ENV NODE_OPTIONS=--max-old-space-size=4096
```

**This is not bun-specific.** The same Dockerfile is generated for all four
package managers and all four get the same setting.

If your builder has very little memory available, raise that value rather than
the build command's flag — the flag alone does not reach the workers.
`tests/scaffolder/packageManagerPortability.test.ts` pins the Dockerfile's build
command to the `build` script it stands in for, so keep the two in step if you
change either.

### pnpm needs its build scripts approved

pnpm 10 and later refuse to run a dependency's install scripts until they are
approved, and **fail the install** rather than skipping them. `create-flowcms`
therefore writes a `pnpm-workspace.yaml` — for pnpm only — approving exactly the
two packages that need a build step:

```yaml
allowBuilds:
  sharp: true
  unrs-resolver: true
```

**The setting's name and shape depend on the pnpm major.** pnpm 9 and 10 take a
list called `onlyBuiltDependencies`; **pnpm 11 takes a map called `allowBuilds`**,
as above. If you hand-edit this file, match the pnpm you actually run — the wrong
spelling is silently ignored and the install fails again.

It stays an allowlist on purpose. A blanket approval hands every transitive
dependency a shell at install time.

### Operating systems

| | Support tier | Verification |
|---|---|---|
| **Linux** | **Verified / primary** | the production target. The package-manager matrix, the image builds and the suite all run on `ubuntu-24.04` |
| **Windows** | **Supported** | the full `verify-create-flowcms.mjs` pass under npm — scaffolding, destination safety, spawn behaviour and the unit suite. No image build: Docker builds are a Linux-runner job |
| **macOS** | **Supported** | the suite and the scaffold run green on the Portability jobs. Nothing in the CLI is platform-specific outside the Windows spawn path. No image build, for the same reason |

Docker is Linux-only in every case: the image is `node:22-bookworm-slim`, and
Docker Desktop on Windows and macOS runs it in a Linux VM.

## What each manager gets

The selected manager decides three things and nothing else: the lockfile, the
install command the CLI and the README use, and the install step rendered into
the generated `Dockerfile`.

| Manager | Lockfile | Image install |
|---|---|---|
| npm | `package-lock.json` | `npm ci --ignore-scripts` |
| pnpm | `pnpm-lock.yaml` | `corepack enable && pnpm install --frozen-lockfile --ignore-scripts` |
| yarn | `yarn.lock` | `corepack enable && yarn install --immutable` (v2+) or `--frozen-lockfile --ignore-scripts` (v1) |
| bun | `bun.lock` | bun copied from `oven/bun:1`, then `bun install --frozen-lockfile --ignore-scripts` |

Corepack ships with Node 22 but is **not enabled by default**, so pnpm and yarn
enable it explicitly. Yarn's frozen-install flag depends on its major version,
which the installer observes from `yarn --version` rather than assuming.

**No lockfile ships.** The template carries none — this repository's own names
`flowcms-app` and a fixture devDependency, and would be wrong for every
generated project. The selected manager writes its own during install, which is
why a Docker build requires an install first and why the rendered Dockerfile
fails with a sentence naming the command that was skipped.

### The runtime is Node, whichever manager installed it

Selecting bun selects a **package manager**. It does not select a runtime.

- The production image is `node:22-bookworm-slim` and stays that way. Bun is
  copied in as a tool during the dependency stage and is not in the runner.
- The application deliberately uses `@libsql/client` rather than `bun:sqlite`
  and `bcryptjs` rather than `Bun.password`, because Turbopack's server-chunk
  loader cannot resolve `bun:*` and the `Bun` global is undefined inside
  Next-compiled server code. That is a fixed architecture decision.
- `bun run` honours the `#!/usr/bin/env node` shebang on the `next` binary, so
  the generated project's commands start a Node process. `bun --bun run …`,
  which forces bun as the runtime, is not supported.

The generated README says all of this in the project itself, because the person
who needs to know is the one reading their own repository a year later.

### Nothing in the image build assumes a manager

Two things used to, and both were npm-shaped defects that only a non-npm project
would ever hit:

- **`scripts/collect-db-drivers.mjs` read `package-lock.json` by name.** It
  stages the PostgreSQL and MySQL drivers, which Next's tracer cannot see. For a
  pnpm, yarn or bun project there is no such file, so the image build died with
  `ENOENT` minutes in, naming a lockfile the operator never chose. It now
  computes the closure from `node_modules`, resolving the way Node itself does —
  which also handles pnpm's default layout, where a transitive dependency is not
  hoisted to the top level.
- **The builder stage ran `RUN npm run build`.** It is a different stage from
  the one that installed: `corepack enable` does not survive across a stage and
  the bun binary is not copied into it, so npm was the only manager that could
  possibly have been there. The build is now invoked through node directly,
  which is true for all four, and a test pins the command to the `build` script
  it stands in for.

## Invocation

After publication, five commands are intended to work. They are **not verified**
— nothing is published, so none of them can be — but each is reasoned from what
it requires of the package, and the package satisfies it: the name is
`create-flowcms`, the `bin` map has a single `create-flowcms` entry, and the
executable takes one positional argument.

| Command | What it resolves | The argument caveat |
|---|---|---|
| `npx create-flowcms@latest my-site` | the `create-flowcms` bin | none; argv is passed through |
| `npm create flowcms@latest my-site` | `npm init flowcms` → `create-flowcms` | **flags need `--`**: `npm create flowcms@latest my-site -- --database sqlite`. Without it npm parses `--database` as its own |
| `pnpm create flowcms my-site` | `create-flowcms` from the registry | flags are forwarded; `--` is accepted either way |
| `yarn create flowcms my-site` | yarn 1 installs `create-flowcms` **globally** and runs it; Berry uses `yarn dlx` | yarn 1's global install is a side effect on the operator's machine that the other three do not have |
| `bun create flowcms my-site` | `create-flowcms` from npm — but only after bun has checked `$HOME/.bun-create`, `./.bun-create` and, for a name containing a slash, GitHub | a local template directory named `flowcms` shadows the package |

Because the four disagree about where their own flags stop, **the CLI accepts a
bare `--` and ignores it**. A separator one manager eats and another forwards
must not be the difference between a working command and a usage error, with
nothing to tell the operator which they hit.

## Known risks, by manager

These are the caveats that remain after verification, and they are why the
support tiers differ. Each one says whether it has been observed or only
reasoned from the tooling's documented behaviour.

### pnpm — supported

- **Corepack downloads at image-build time.** `corepack enable && pnpm install`
  in the Dockerfile resolves a pnpm version from the `packageManager` field, and
  fetching it is a network request during the build. Behind a proxy or in an
  air-gapped builder that fails.
- **Without an observed version there is no `packageManager` field**, and
  corepack then uses its own pinned default. If that default's major differs
  from the one that wrote `pnpm-lock.yaml`, `--frozen-lockfile` refuses the
  lockfile rather than silently updating it — which is the right failure, but it
  is a failure.
- **`file:packages/flowcms`.** pnpm links a `file:` directory rather than
  copying it, so the local theme package resolves to the project's own source
  and `build:packages` output lands where the build expects it. Reasoned, not
  observed.

### bun — experimental

Bun is verified on the matrix and builds a working image. It stays
**Experimental** because of the three caveats below: it is the one manager
outside corepack's remit, its lockfile format changed recently enough that an
older bun silently produces the wrong one, and its base image is the least
insulated from an upstream retag.

- **`bun.lock`, not `bun.lockb`.** Bun 1.2 made the text lockfile the default
  and this repository's own is `bun.lock`. An operator on bun 1.1 produces
  `bun.lockb`, the image build's `test -f bun.lock` fails, and the message tells
  them to run an install they already ran.
- **The `packageManager` field is deliberately omitted for bun.** Corepack
  manages three package managers and does not know bun; a manifest saying
  `bun@1.3.14` makes every corepack shim in that project fail with
  `Unsupported package manager "bun"` — which is npm, pnpm and yarn on any
  machine where `corepack enable` was ever run for something else. Bun does not
  read the field, so writing it bought nothing. The choice is still recorded, in
  `.flowcms/project.json`.
- **`oven/bun:1` is Debian-based**, matching `node:22-bookworm-slim`'s glibc.
  A future retag of that image to a different libc would break the copy.

### yarn — supported on 1.x Classic, untested on Berry

**The supported range is Yarn 1 Classic**, and the split below is why.

The Yarn 1 `file:` snapshot risk is **cleared by evidence**: a generated yarn
project installs, then runs `build:packages` and `next build` in that order, and
`flowcms/theme` resolves. **Berry (2+) has never been run**, so nothing below
about PnP has been observed either way — it is outside the supported range
rather than a known defect.

- **Yarn Berry defaults to Plug'n'Play**, which means no `node_modules` at all.
  The generated project's `build` script is
  `node --max-old-space-size=4096 node_modules/next/dist/bin/next build` — a
  literal path into a directory PnP does not create — and the Dockerfile's build
  step is the same command. A Berry project would need `nodeLinker: node-modules`
  in a `.yarnrc.yml` that the template does not ship.
- **Yarn 1 copies a `file:` dependency into `node_modules` at install time.**
  The generated project depends on its own `flowcms` copy as
  `file:packages/flowcms`, and the supported order is install → `build:packages`
  → build. If the install took a snapshot before `dist` existed, `flowcms/theme`
  resolves to a copy with no build output in it, and the failure is a module
  resolution error during `next build` rather than anything naming yarn.

Additionally, the rendered Dockerfile copies `yarn.lock*` and the manifests, but
**not** `.yarnrc.yml` or `.yarn/releases/`, which a Berry project needs in the
build context for `corepack enable` to reach the right yarn.

Berry remains selectable, and honestly labelled as outside the supported range.
It is not removed: refusing a manager somebody's whole organisation standardised
on is a worse answer than telling them what is untested about it.

## Cross-platform behaviour

### Line endings

`.gitattributes` pins LF for everything a kernel or an image build executes, and
it ships with the template. Git for Windows installs with `core.autocrlf=true`,
which rewrites text files to CRLF on checkout; a CRLF shebang makes the kernel
look for the interpreter `/bin/sh\r`, and the container exits reporting that a
path which obviously exists does not. `create-flowcms` copies the template byte
for byte, so whatever a contributor has on disk is what every generated project
gets — and an operator who commits their new site and clones it on Windows must
not get an image that will not start.

### Spawning a package manager on Windows

npm, pnpm and yarn are `.cmd` shims on Windows, and since the fix for
CVE-2024-27980 `child_process.spawn` refuses to launch a `.cmd` without a shell:
it fails with `EINVAL` before the process exists. Nothing about that failure
resembles its cause — the availability probe saw the rejection and reported the
manager as absent, so `create-flowcms` told operators that the npm they had just
invoked it with was not on their PATH.

The interpreter is therefore named explicitly on Windows, and it — not a table
in this repository — decides the extension. Bun ships `bun.exe` rather than a
`.cmd`, which is why any table that guessed an extension got one of the four
wrong.

Naming `cmd.exe` is **not** `shell: true`. That option routes every argument
through a parser; this routes one fixed string built from the CLI's own tables —
a manager name and the literal argument `install` or `--version`. Nothing an
operator typed is on that command line: their project path travels as `cwd`,
which is a spawn option and is never parsed. `/d` skips AutoRun commands from
the registry, which would otherwise execute inside the probe.

### File permissions

The generated `.env` is `chmod 0600` on POSIX and **best effort** elsewhere. A
POSIX mode does not mean the same thing on Windows and the call silently does
nothing there; failing project creation over a permission bit would trade a real
outcome for a cosmetic one. On Linux and macOS the file holding `AUTH_SECRET`
becomes owner-only, which is what matters on a shared machine. `.gitignore` is
what keeps it out of a repository on every platform.

The `bin/create-flowcms.mjs` executable bit is **not** carried by git on
Windows — `core.filemode` is false there, so the file is committed mode `100644`
and npm packs it that way. This is safe for the published package, because npm,
pnpm, yarn and bun all set the executable bit themselves when they link a `bin`
entry. It is not safe for running `./bin/create-flowcms.mjs` directly out of a
clone on Linux, which needs `node bin/create-flowcms.mjs` or a `chmod +x`.

### Paths

Every path is built with `node:path` and every temporary directory comes from
`os.tmpdir()`. The filesystem root is detected as `parse(target).root ===
target`, which covers `/` and `C:\` without special-casing either. Destination
checks use `lstat` rather than `stat`, so a symlink pointing at an empty
directory is refused instead of written through.

`COMPOSE_PATH_SEPARATOR` is written explicitly into the generated `.env`, because
Compose's default differs by platform (`:` on POSIX, `;` on Windows) and that
file is committed and shared.

## Verifying masked input on a real terminal

Automated coverage goes as far as it can without a pty: `tests/scaffolder/
interactivePrompts.test.ts` drives the real prompts through injected streams,
and `tests/scaffolder/interactiveInterrupt.test.ts` covers interruption and the
"masking is not possible here" warning. **Neither is a terminal.** Echo
suppression under raw mode is a property of readline plus the TTY driver, and a
`PassThrough` exercises neither — readline does not echo a non-TTY input at all,
which is what made the first version of the masking test vacuous.

No pty dependency has been added, and none should be added for this. A terminal
framework is a supply chain and a version to track, bought to observe one
behaviour a person can observe in thirty seconds. Until CI has a pty step, this
is the procedure.

### The procedure

Run it on **each** of Windows, macOS and Linux, in a real terminal — not an IDE
console, not a CI log, and not through a pipe.

1. Scaffold with an external S3 endpoint, so a secret is asked for:

   ```bash
   node packages/create-flowcms/bin/create-flowcms.mjs /tmp/pty-check \
     --deployment local --database sqlite --storage s3 --redis none
   ```

   The five S3 questions follow. **Access key ID** is an ordinary field;
   **Secret access key** is the masked one.

2. At the secret prompt, type a recognisable value — `MASKCHECK-1` — slowly.

   - [ ] Nothing appears as you type. No characters, no asterisks, no width.
   - [ ] Backspace and Ctrl+U produce nothing visible either.
   - [ ] Enter moves to the next line.

3. Finish the run, then check the scrollback:

   - [ ] `MASKCHECK-1` appears nowhere above the prompt.
   - [ ] The summary says `Generated` / `configured` and no secret value.

4. Confirm the value actually arrived:

   - [ ] `S3_SECRET_ACCESS_KEY` in the generated `.env` is `MASKCHECK-1`.
     Masking that also drops the input is the failure this step catches.

5. Interruption, from a fresh run with no flags:

   - [ ] Ctrl+C at any question ends the line rather than leaving the cursor
     mid-prompt.
   - [ ] It prints `Interrupted. Nothing was written.`
   - [ ] The exit code is `130` (`echo $?`, or `$LASTEXITCODE` in PowerShell).
   - [ ] The destination directory does not exist.

6. The redirection case, which the CLI warns about rather than solves:

   ```bash
   node packages/create-flowcms/bin/create-flowcms.mjs /tmp/pty-check-2 \
     --deployment local --database postgresql --storage s3 --redis none | tee install.log
   ```

   - [ ] Before the masked question, the prompt warns that input cannot be
     hidden in this mode.
   - [ ] What you type is visible — that is the expected outcome, and the
     warning is what makes it acceptable.

7. Delete `/tmp/pty-check*` and `install.log`. `MASKCHECK-1` is not a real
   credential, but the habit is the point.

Record the platform, the terminal emulator and the result. A pass on one
terminal is not a pass on all of them: Windows Terminal, `conhost.exe`, iTerm2
and a bare Linux VT are four different implementations of the thing being
tested.

## What CI must run

The coverage this document's claims rest on. The workflows that implement it are
documented in [`docs/ci.md`](../ci.md).

| Job | Runners | What it proves |
|---|---|---|
| Unit suite | ubuntu, windows, macos | the scaffolder, policy and packaging suites pass on all three |
| Scaffold smoke, npm | ubuntu, windows, macos | `create-flowcms` produces a project and installs it |
| Package-manager matrix | ubuntu only | pnpm, yarn and bun each scaffold, install, build, typecheck and lint |
| Docker image | ubuntu only | `docker build` from a generated project, per manager |
| Package boundary | ubuntu only | `verify-package-consumer.mjs`, tarball contents, the Tailwind proof |

The cost shape is deliberate: three OSes for the cheap jobs, one OS for the
expensive matrix. A package manager's behaviour differs far more between
managers than between operating systems, and Docker only runs on Linux runners
anyway.
