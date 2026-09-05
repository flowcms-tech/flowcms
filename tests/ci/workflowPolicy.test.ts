import { describe, expect, it } from "vitest"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * THE CI POLICY, PINNED.
 *
 * Workflow files are the one part of this repository that cannot be exercised
 * by running it. They execute on GitHub, on a push, in an environment nobody
 * has locally — so the properties that matter most about them (least
 * privilege, no ACCIDENTAL publishing, no credential in the YAML) are exactly
 * the properties nothing otherwise checks.
 *
 * This suite reads them as TEXT rather than parsed YAML, deliberately. Parsing
 * would need a YAML library this repository does not depend on, and the
 * assertions worth making here are about what a reviewer would see in a diff:
 * a literal `contents: write`, a literal `@main`, a literal token.
 *
 * It cannot verify that a workflow RUNS, and a green run would not make these
 * assertions redundant: the pipeline has run, and `0.1.0` has been published
 * through it, but a run only proves the path taken that day. What is pinned
 * here is the policy the workflows encode — the parts that must stay true of
 * every future run, including the ones nobody is watching.
 */

const ROOT = process.cwd()
const DIR = join(ROOT, ".github", "workflows")

const FILES = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .sort()
  : []

const read = (file: string) => readFileSync(join(DIR, file), "utf8")

/** These files carry a lot of prose; a policy check must not trip on it. */
function withoutComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
}

/**
 * Every value assigned to `key:` across a file, trimmed and unquoted.
 *
 * The optional leading `- ` matters: `uses:` appears both as a job-level key
 * (`uses: ./.github/workflows/ci.yml`) and as the first key of a step
 * (`- uses: actions/checkout@v5`). A pattern that missed the second form would
 * silently check nothing at all, which is the failure mode this whole file
 * exists to avoid.
 */
function valuesFor(source: string, key: string): string[] {
  const out: string[] = []
  for (const line of source.split("\n")) {
    const match = new RegExp(`^\\s*(?:-\\s+)?${key}:\\s*(.*)$`).exec(line)
    if (match) out.push(match[1].trim().replace(/^["']|["']$/g, ""))
  }
  return out
}

const RELEASE = "release.yml"

/**
 * The other half of the release path. It creates the tag on a version-bumping
 * merge and dispatches `release.yml` against it; it never publishes anything
 * itself. Kept as a named constant because several assertions below have to
 * treat the release path as two files rather than one.
 */
const RELEASE_ON_MERGE = "release-on-merge.yml"

describe("the workflows exist", () => {
  it("has a .github/workflows directory", () => {
    expect(existsSync(DIR), ".github/workflows is missing").toBe(true)
  })

  it.each([
    ["ci.yml", "the pull-request tier"],
    ["docker.yml", "the image build and runtime smoke"],
    ["database-matrix.yml", "the four-engine database gates"],
    ["consumer-proofs.yml", "the clean-consumer proofs"],
    ["portability.yml", "the Windows/macOS suites and the package-manager matrix"],
    [RELEASE, "the release proof and the gated publish job"],
    [RELEASE_ON_MERGE, "the tag and dispatch a version-bumping merge produces"],
  ])("ships %s — %s", (file) => {
    expect(FILES).toContain(file)
  })
})

describe("least privilege", () => {
  it.each(FILES)("%s declares a top-level read-only permission block", (file) => {
    const source = withoutComments(read(file))
    // Top-level: column zero, before any job's indented block.
    expect(source, `${file} has no top-level permissions block`).toMatch(
      /^permissions:\n\s+contents: read\b/m,
    )
  })

  /**
   * TWO FILES MAY ELEVATE, and they are the two the release path is made of.
   * Everything else in this directory runs tests and needs nothing.
   *
   * `release-on-merge.yml` joined the list when the release stopped being typed
   * by hand: it pushes a tag (`contents: write`) and dispatches `release.yml`
   * (`actions: write`). Neither of those touches the registry — it holds no
   * credential and runs no publish step, which the release-safety suite below
   * asserts directly rather than leaving to this exemption.
   */
  const MAY_ELEVATE = [RELEASE, RELEASE_ON_MERGE]

  it("grants a write permission only in the two release workflows", () => {
    for (const file of FILES) {
      if (MAY_ELEVATE.includes(file)) continue
      const source = withoutComments(read(file))
      const writes = source.match(/^\s*[a-z-]+:\s*write\b/gm) ?? []
      expect(writes, `${file} asks for a write permission`).toEqual([])
    }
  })

  it("keeps release-on-merge.yml's elevation scoped to its one job and to two scopes", () => {
    const source = withoutComments(read(RELEASE_ON_MERGE))

    // Top-level stays read, as everywhere else.
    expect(source, "release-on-merge.yml's top-level permissions are not read-only").toMatch(
      /^permissions:\n\s+contents: read\b/m,
    )

    const jobsAt = source.indexOf("\njobs:")
    expect(jobsAt, "release-on-merge.yml declares no jobs").toBeGreaterThan(-1)

    // Exactly the two it needs, and nothing that could reach the registry or a
    // deployment on its own.
    const writes = (source.match(/^\s+([a-z-]+):\s*write\b/gm) ?? []).map((line) =>
      line.trim().replace(/:\s*write$/, ""),
    )
    expect(
      [...writes].sort(),
      "release-on-merge.yml asks for a write scope beyond pushing a tag and dispatching",
    ).toEqual(["actions", "contents"])

    for (const match of source.matchAll(/^\s+[a-z-]+:\s*write\b/gm)) {
      expect(
        match.index,
        `release-on-merge.yml declares ${match[0].trim()} outside its job block`,
      ).toBeGreaterThan(jobsAt)
    }
  })

  it("keeps the release workflow's one elevated permission scoped to the publish job", () => {
    const source = withoutComments(read(RELEASE))
    const publishAt = source.indexOf("\n  publish:")
    expect(publishAt, "release.yml has no publish job").toBeGreaterThan(-1)

    // The elevation belongs to one job. Raising the top-level block would hand
    // it to every tier, including the ones that only run tests.
    expect(source, "release.yml's top-level permissions are not read-only").toMatch(
      /^permissions:\n\s+contents: read\b/m,
    )

    // npm provenance is OIDC, and refuses without it.
    const idToken = source.search(/^\s+id-token: write\b/m)
    expect(idToken, "release.yml never asks for id-token: write").toBeGreaterThan(-1)
    expect(idToken, "id-token: write is declared outside the publish job").toBeGreaterThan(
      publishAt,
    )

    /**
     * LEAST PRIVILEGE, tied to the one capability that would need it.
     *
     * `contents: write` exists in this file for exactly one thing:
     * `gh release create`. While that step is disabled the publish path writes
     * nothing back to the repository, so requesting write would hand the job a
     * token it never spends — and a token nobody spends is one nobody notices
     * being misused.
     *
     * The assertion runs in both directions deliberately. Disabled step: write
     * must be absent. Enabled step: write must be present AND scoped to this
     * job. Neither half can be changed on its own, so the permission and the
     * capability that justifies it always arrive in the same commit.
     */
    const releaseStepAt = source.indexOf("name: Create the GitHub Release")
    const releaseStepIsDisabled =
      releaseStepAt === -1 ||
      /if:\s*\$\{\{\s*false\s*\}\}/.test(source.slice(releaseStepAt, releaseStepAt + 300))

    if (releaseStepIsDisabled) {
      expect(
        source.match(/^\s*contents: write\b/gm) ?? [],
        "release.yml asks for contents: write while the GitHub Release step is disabled",
      ).toEqual([])
    } else {
      const contents = source.search(/^\s+contents: write\b/m)
      expect(
        contents,
        "the GitHub Release step is enabled but the job cannot write contents",
      ).toBeGreaterThan(-1)
      expect(contents, "contents: write is declared outside the publish job").toBeGreaterThan(
        publishAt,
      )
    }
  })
})

describe("supply chain", () => {
  it.each(FILES)("%s pins every action to a version, never a branch", (file) => {
    const source = withoutComments(read(file))
    const refs = valuesFor(source, "uses")
    // A vacuous pass here would be indistinguishable from a real one, and the
    // extraction is the fragile part of this suite.
    expect(refs.length, `${file}: no \`uses:\` was extracted — the parser missed them`)
      .toBeGreaterThan(0)
    for (const ref of refs) {
      // A local reusable workflow is referenced by path and carries no version.
      if (ref.startsWith("./")) continue
      expect(ref, `${file}: "${ref}" is not pinned to a version or a sha`).toMatch(
        /@(v\d+(\.\d+)*|[0-9a-f]{40})$/,
      )
      expect(ref, `${file}: "${ref}" is pinned to a moving ref`).not.toMatch(
        /@(main|master|latest|HEAD)$/,
      )
    }
  })

  /**
   * THE ONE ALLOWED `npm install`, AND IT IS NOT A DEPENDENCY INSTALL.
   *
   * `consumer-proofs.yml` replaces the workspace-linked Aurora fixture with the
   * PACKED one, because a `file:` dependency is a symlink and a symlink is not
   * what a theme consumer receives — Next's tracer and Tailwind's `@source` both
   * behave differently against it, so the gates were measuring an artifact the
   * build never produces.
   *
   * The policy this exception sits inside is about REPRODUCIBILITY: a CI job
   * must not silently rewrite the lockfile. This operation cannot, and the
   * pattern below makes it prove that rather than promise it:
   *
   *   --no-save          nothing is written to package.json
   *   --no-package-lock  nothing is written to package-lock.json
   *   a $RUNNER_TEMP tarball path, not a registry name — so no arbitrary
   *                      package can be pulled in through this hole
   *
   * The workflow then runs `git diff --exit-code` on both manifests, so a future
   * npm that ignored these flags fails the job instead of quietly changing the
   * tree. Anything else — a bare `npm install`, a registry name, a missing flag
   * — is still rejected.
   */
  const packedFixtureInstall = () =>
    /npm install --no-save --no-package-lock --no-audit --no-fund "\$RUNNER_TEMP\/\$tarball"/g

  /**
   * THE SECOND EXCEPTION: the npm CLI itself.
   *
   * npm Trusted Publishing is performed by the npm CLI, not by the workflow —
   * it is the client that exchanges the runner's OIDC identity for a
   * short-lived publish credential — and it needs a version newer than the one
   * bundled with the project's Node line. So the release workflow installs a
   * CLI globally.
   *
   * That is categorically different from the policy this sits inside. This
   * installs the PACKAGE MANAGER, globally, touching no lockfile and no
   * manifest; the reproducibility rule is about project dependencies, which are
   * still `npm ci`. The pattern below is what keeps the difference from
   * eroding: `-g`, the literal package `npm`, and an exact pinned version. A
   * range, a dist-tag, or any other package name is not matched here and is
   * therefore still rejected as a bare `npm install`.
   */
  const globalNpmCliInstall = () => /npm install -g npm@(\d+)\.(\d+)\.(\d+)\b/g

  it.each(FILES)("%s installs with `npm ci`, never `npm install`", (file) => {
    const source = withoutComments(read(file))
      .replace(packedFixtureInstall(), "«packed-fixture»")
      .replace(globalNpmCliInstall(), "«pinned-npm-cli»")
    expect(
      source,
      `${file} uses npm install; the lockfile would be rewritten silently instead of enforced`,
    ).not.toMatch(/\bnpm\s+install\b/)
    if (/\bnpm\b/.test(source)) expect(source).toMatch(/npm ci\b/)
  })

  it("the npm CLI exception is one pinned upgrade, in the release workflow only", () => {
    /**
     * Narrow by construction, in four independent ways. Widening any of them
     * fails here rather than passing quietly:
     *
     *   - it appears in exactly one workflow, and that workflow is the release
     *   - it appears exactly once in that workflow
     *   - the package is literally `npm` and nothing else
     *   - the version is an exact semver, so `@latest`, `^11`, `11.x` and every
     *     other floating specifier fall outside the exception and are rejected
     *     by the `npm ci` rule above
     *
     * The floor is the property that actually matters: below npm 11.5.1 the CLI
     * cannot do the OIDC exchange at all, so a downgrade past it would silently
     * turn the publish back into something that needs a token.
     */
    const users = FILES.filter((f) => globalNpmCliInstall().test(withoutComments(read(f))))
    expect(users, "the pinned npm CLI upgrade appears outside the release workflow").toEqual([
      RELEASE,
    ])

    const matches = [...withoutComments(read(RELEASE)).matchAll(globalNpmCliInstall())]
    expect(matches.length, "release.yml installs the npm CLI more than once").toBe(1)

    const [, major, minor, patch] = matches[0].map(Number)
    const atLeast = (a: number, b: number, c: number) =>
      major > a || (major === a && (minor > b || (minor === b && patch >= c)))
    expect(
      atLeast(11, 5, 1),
      `release.yml pins npm@${major}.${minor}.${patch}, which is below the 11.5.1 that Trusted Publishing requires`,
    ).toBe(true)

    // And the workflow must check it got what it asked for: a global install
    // that silently resolved elsewhere would run the exchange on an unknown
    // client.
    expect(
      withoutComments(read(RELEASE)),
      "release.yml never verifies the npm version it just pinned",
    ).toMatch(/npm --version/)
  })

  it("the packed-fixture exception lives in exactly one workflow and keeps its guards", () => {
    // Narrow by construction. If this exception appears anywhere else, or loses
    // its `git diff --exit-code` proof, this fails rather than widening quietly.
    const users = FILES.filter((f) => packedFixtureInstall().test(withoutComments(read(f))))
    expect(users).toEqual(["consumer-proofs.yml"])

    expect(
      read("consumer-proofs.yml"),
      "the exception must prove it changed neither manifest",
    ).toMatch(/git diff --exit-code -- package-lock\.json package\.json/)
  })

  it.each(FILES)("%s pipes no remote script into a shell", (file) => {
    const source = withoutComments(read(file))
    expect(source, `${file} pipes a download into a shell`).not.toMatch(
      /(curl|wget)[^\n|]*\|\s*(sudo\s+)?(ba)?sh\b/,
    )
  })

  it.each(FILES)("%s pins the runner image rather than using -latest", (file) => {
    const source = withoutComments(read(file))
    for (const runner of valuesFor(source, "runs-on")) {
      expect(runner, `${file}: runs-on: ${runner}`).not.toMatch(/-latest$/)
    }
  })

  it.each(FILES)("%s pins the runner images inside an os matrix too", (file) => {
    // `runs-on: ${{ matrix.os }}` satisfies the check above vacuously — the
    // literal images live in the matrix list, which is the only place a
    // `-latest` could still hide.
    const source = withoutComments(read(file))
    for (const line of source.match(/^\s*os:\s*\[.*\]$/gm) ?? []) {
      expect(line, `${file}: ${line.trim()} tracks a moving runner image`).not.toMatch(/-latest/)
    }
  })
})

describe("node version", () => {
  it.each(FILES)("%s targets Node 22 and only Node 22", (file) => {
    const source = withoutComments(read(file))
    for (const value of valuesFor(source, "node-version")) {
      // Either the literal 22 or the file's own NODE_VERSION env, which is 22.
      expect(value, `${file}: node-version: ${value}`).toMatch(
        /^(22|\$\{\{\s*env\.NODE_VERSION\s*\}\})$/,
      )
    }
    for (const value of valuesFor(source, "NODE_VERSION")) {
      expect(value, `${file}: NODE_VERSION: ${value}`).toBe("22")
    }
    // A version matrix would test combinations nothing ships on: engines.node
    // is >=22, the image is node:22-bookworm-slim, generated projects require
    // the same.
    expect(source, `${file} declares a Node version matrix`).not.toMatch(/node-version:\s*\[/)
  })
})

describe("no secret dependence", () => {
  const APP_SECRETS = ["AUTH_SECRET", "CAPTCHA_SECRET", "PREVIEW_SECRET", "FLOWCMS_SETUP_TOKEN"]

  it.each(FILES)("%s assigns no application secret a literal value", (file) => {
    const source = withoutComments(read(file))
    for (const key of APP_SECRETS) {
      for (const value of valuesFor(source, key)) {
        // Only an expression, or nothing, may appear as a YAML value. The real
        // values are generated in-job by scripts/ci/generate-test-secrets.mjs
        // and reach the shell as $AUTH_SECRET, never as YAML.
        expect(value, `${file}: ${key}: ${value} embeds a literal secret`).toMatch(
          /^(\$\{\{.*\}\}|)$/,
        )
      }
    }
  })

  it("reads no repository secret, anywhere, including for publishing", () => {
    /**
     * This assertion used to carve out one exception: `secrets.NPM_TOKEN` in
     * the publish job, for the first publication. That exception is gone, and
     * it is gone for a reason worth stating.
     *
     * npm Trusted Publishing authenticates the release by exchanging the
     * runner's GitHub OIDC identity for a short-lived, single-use credential.
     * No tracked workflow holds anything long-lived to leak or to rotate, and
     * the credential that is minted cannot be used from another repository or
     * another workflow. Re-introducing a publish token would not merely add a
     * secret — it would reopen the class of failure that Trusted Publishing
     * exists to close, while leaving every other gate in this file untouched.
     *
     * So the policy is now absolute: no workflow reads any repository secret.
     * The test suite's own credentials are generated in-job and die with the
     * runner; see the assertion below.
     */
    for (const file of FILES) {
      const source = withoutComments(read(file))
      // Scoped to expression context on purpose. A repository secret can only
      // be read through `${{ }}`; matching the bare word would also flag
      // `scripts/ci/generate-test-secrets.mjs`, which is the very script that
      // makes reading one unnecessary.
      const refs = (source.match(/\$\{\{[\s\S]*?\}\}/g) ?? []).flatMap(
        (expression) => expression.match(/\bsecrets\.[A-Za-z_][A-Za-z0-9_]*/g) ?? [],
      )
      expect(refs, `${file} reads a repository secret: ${refs.join(", ")}`).toEqual([])
    }
  })

  it("generates its secrets in-job, in every workflow that needs one", () => {
    const users = FILES.filter((f) => APP_SECRETS.some((s) => read(f).includes(`$${s}`)))
    for (const file of users) {
      expect(read(file), `${file} uses a secret it never generates`).toMatch(
        /scripts\/ci\/generate-test-secrets\.mjs/,
      )
    }
  })

  it("does not hand the test suite an AUTH_SECRET, in either OS tier", () => {
    // NOT a hygiene preference — setting it FAILS a suite, and the two jobs
    // that run `npm test` must agree about that or Windows and macOS diverge
    // from Linux on the first run.
    //
    // `resolveAuthSecret()` is a frozen module-load snapshot
    // (CONFIGURED_AT_LOAD / VERDICT_AT_LOAD), so it reports the environment the
    // worker STARTED with and no afterEach can reach it. The last test in
    // tests/auth/authSecretLeakage.test.ts asserts unconditionally that it
    // returns undefined; a generated AUTH_SECRET is a valid 44-character random
    // base64 string, classifies as `usable`, and falsifies that assertion.
    //
    // Every suite that needs a secret sets it itself. The workflows that
    // legitimately generate them are the ones that RUN the application.
    for (const file of ["ci.yml", "portability.yml"]) {
      const source = withoutComments(read(file))
      expect(source, `${file} generates secrets for a job that only runs tests`).not.toMatch(
        /generate-test-secrets\.mjs/,
      )
    }
  })

  it("labels the CI database password as the non-secret it is", () => {
    // Service credentials cannot be generated — GitHub evaluates `services:`
    // before any step of the job runs. Pinning the string keeps the next person
    // from swapping in something that looks like, and might one day be, a real
    // credential.
    const source = withoutComments(read("database-matrix.yml"))
    expect(source).toMatch(/not_a_secret/)
    expect(source, "the database matrix reads a repository secret").not.toMatch(/secrets\./)
  })

  it("generates a whole compose environment where generation IS possible", () => {
    expect(read("database-matrix.yml")).toMatch(/scripts\/ci\/write-ci-env\.mjs/)
  })
})

describe("database matrix", () => {
  const source = () => withoutComments(read("database-matrix.yml"))

  it("verifies MariaDB as its own job, not as a second MySQL", () => {
    const text = source()
    expect(text).toMatch(/^\s{2}contract-mariadb:/m)
    expect(text).toMatch(/^\s{2}contract-mysql:/m)
    expect(text).toMatch(/image: mariadb:11\.4/)
    expect(text).toMatch(/image: mysql:8\.4/)
    // The distinguishing variables. If MariaDB were aliased to MySQL, the suite
    // would receive TEST_MYSQL_URL twice and report two MySQL runs as four
    // engines verified.
    expect(text).toMatch(/TEST_MARIADB_URL/)
    expect(text).toMatch(/TEST_MYSQL_URL/)
    expect(text).toMatch(/DATABASE_DIALECT: mariadb/)
    expect(text).toMatch(/DATABASE_DIALECT: mysql/)
  })

  it("covers PostgreSQL 17 and all four engines in the topology matrix", () => {
    const text = source()
    expect(text).toMatch(/image: postgres:17/)
    expect(text).toMatch(/engine: \[sqlite, postgres, mysql, mariadb\]/)
  })

  it("migrates the remote engines before running the suite", () => {
    // tests/db/contract.test.ts says it outright: "Remote engines are migrated
    // by the harness that starts them." This file is that harness.
    const migrations = source().match(/node scripts\/migrate\.mjs/g) ?? []
    expect(migrations.length).toBeGreaterThanOrEqual(3)
  })

  it("gives every database service a health check", () => {
    const text = source()
    const images = (text.match(/^\s+image: (postgres|mysql|mariadb):/gm) ?? []).length
    const healthChecks = (text.match(/--health-cmd/g) ?? []).length
    expect(images).toBe(3)
    expect(healthChecks).toBe(images)
  })
})

describe("docker gates", () => {
  const source = () => withoutComments(read("docker.yml"))

  /**
   * The extended regex the relevance job matches changed file names against.
   *
   * Scoped to that job on purpose. A check that searched the whole file would
   * stay green after a path was dropped from the detector, as long as the same
   * string survived anywhere else in the workflow — another job, a step name,
   * an echo. The residual risk this design carries is a SILENT under-run, where
   * Docker quietly stops running and the gate still reports green, so the
   * assertion has to read the thing that actually decides.
   */
  function relevancePattern(text: string): string | undefined {
    const at = text.indexOf("name: Docker-relevant changes")
    if (at === -1) return undefined
    const nextJob = text.indexOf("\n  image:", at)
    const job = text.slice(at, nextJob === -1 ? text.length : nextJob)
    return job.match(/grep -Eq\s+'([^']+)'/)?.[1]
  }

  it("builds an image and never pushes one", () => {
    const text = source()
    expect(text).toMatch(/docker build/)
    expect(text, "docker.yml pushes an image").not.toMatch(/docker\s+push\b/)
    expect(text, "docker.yml logs in to a registry").not.toMatch(/docker\s+login\b/)
    expect(text).not.toMatch(/push:\s*true/)
  })

  it("proves the container serves, not merely that it builds", () => {
    // Phase 3 established that this application can bind its port while serving
    // nothing but 500s, which is why the healthcheck is an HTTP probe and why a
    // build-only Docker gate would be worth very little.
    const text = source()
    expect(text).toMatch(/\/api\/ready/)
    expect(text).toMatch(/\/api\/health/)
  })

  it("checks that no configured secret reached the container log", () => {
    expect(source()).toMatch(/No secret reached the container log/)
  })

  it("does not filter pull requests at trigger level", () => {
    // A workflow-level `paths:` filter means the workflow — and therefore any
    // gate inside it — does not exist on an unrelated pull request. A required
    // check that is never reported blocks merging forever, and the symptom (a
    // pull request pending with no explanation) does not name its cause.
    // Relevance is decided inside the run instead; see the `changes` job.
    const text = source()
    const on = text.slice(text.indexOf("on:"), text.indexOf("permissions:"))
    const pr = on.indexOf("pull_request:")
    expect(pr, "docker.yml no longer runs on pull requests at all").toBeGreaterThan(-1)

    // Everything between `pull_request:` and the next key at the same or lower
    // indentation is that trigger's own block.
    const rest = on.slice(pr + "pull_request:".length)
    const end = rest.search(/\n {0,2}\S/)
    const block = end === -1 ? rest : rest.slice(0, end)
    expect(block, "docker.yml filters pull requests at trigger level again").not.toMatch(
      /^\s*paths(-ignore)?:/m,
    )
  })

  it("exposes one always-reporting gate that tolerates a legitimate skip", () => {
    const text = source()
    expect(text, "docker.yml has no Docker gate").toMatch(/name:\s*Docker gate/)

    const at = text.indexOf("name: Docker gate")
    const job = text.slice(at, at + 1000)
    expect(job, "the gate does not always run, so it cannot always report").toMatch(
      /if:\s*always\(\)/,
    )
    expect(job, "the gate does not aggregate the image job").toMatch(/needs:[^\n]*\bimage\b/)
    expect(job, "the gate ignores failure or cancellation").toMatch(/\*failure\*\|\*cancelled\*/)
    // `skipped` is legitimate and must stay legitimate: `image` is off on a
    // pull request with no Docker-relevant change, and `generated-image` is off
    // outside full depth. `CI gate` treats a skip as failure — correctly, for
    // its own always-run jobs — and copying that here would fail every
    // documentation-only pull request.
    expect(job, "the gate treats a legitimate skip as a failure").not.toMatch(/\*skipped\*/)
  })

  it("matches every path the trigger filter covered, and nothing else", () => {
    // READS THE THING THAT DECIDES, not the file that contains it.
    //
    // An earlier draft ran `toContain` over the whole of docker.yml. That is
    // weaker than it looks: drop a path from the detector and the assertion
    // stays green as long as the same string survives anywhere else in the
    // workflow.
    //
    // It is EXECUTED rather than string-matched, which also makes it immune to
    // escaping style: `next\.config\.ts` and `next[.]config[.]ts` are the same
    // detector and must both pass. (JS regex and POSIX ERE differ in corners
    // this pattern does not use — alternation, anchors, escaped dots and one
    // negated class.)
    const pattern = relevancePattern(source())
    // Fails CLOSED. If the detection idiom changes, this test must be updated
    // deliberately rather than silently passing over a pattern it cannot see.
    expect(
      pattern,
      "no `grep -Eq '…'` relevance pattern found in the Docker-relevant changes job",
    ).toBeDefined()

    const relevant = new RegExp(pattern as string)

    // Every path the trigger filter used to carry, as a real file name.
    for (const file of [
      "Dockerfile",
      ".dockerignore",
      "docker/entrypoint.sh",
      "compose.yml",
      "compose.postgres.yml",
      "next.config.ts",
      "package.json",
      "package-lock.json",
      "scripts/collect-db-drivers.mjs",
      "scripts/migrate.mjs",
      "scripts/bootstrap-owner.mjs",
      ".github/workflows/docker.yml",
    ]) {
      expect(relevant.test(file), `the relevance pattern no longer matches ${file}`).toBe(true)
    }

    // And the other direction, which a `toContain` check cannot express at all:
    // an unanchored or over-broad pattern would pay for a container build on
    // every documentation commit, which is the cost this design exists to
    // avoid.
    for (const file of [
      "README.md",
      "docs/ci.md",
      "docs/Dockerfile-notes.md",
      "src/app/page.tsx",
      "packages/create-flowcms/package.json",
    ]) {
      expect(relevant.test(file), `the relevance pattern now matches ${file}`).toBe(false)
    }
  })
})

describe("release safety", () => {
  const raw = () => read(RELEASE)

  /**
   * The publish job's steps, in order, each bounded to its own text.
   *
   * Bounding matters: several assertions below are about what a step does NOT
   * contain, and a search across the whole file would find the thing in some
   * other step and pass for the wrong reason. `registry.npmjs.org`, for one,
   * appears both in the setup-node registry-url and in the release-target
   * preflight.
   */
  function publishSteps(text: string): { name: string; body: string; at: number }[] {
    const jobAt = text.indexOf("\n  publish:")
    if (jobAt === -1) return []
    // The publish job is the last job in the file, so it runs to the end.
    const job = text.slice(jobAt)
    const heads: { name: string; index: number }[] = []
    const head = /^ {6}- name: (.+)$/gm
    let match: RegExpExecArray | null
    while ((match = head.exec(job))) heads.push({ name: match[1].trim(), index: match.index })
    return heads.map((step, i) => {
      const end = i + 1 < heads.length ? heads[i + 1].index : job.length
      return { name: step.name, body: job.slice(step.index, end), at: jobAt + step.index }
    })
  }

  /**
   * THE POLICY THIS SUITE PINS, AND HOW IT CHANGED.
   *
   * It used to read: four independent things must line up before anything
   * reaches the registry, "and none of them is something an ordinary push or a
   * merge can supply." That was true while a maintainer created the tag by hand
   * and typed the dispatch inputs at the Actions UI.
   *
   * It is no longer true, and pretending otherwise would be worse than the
   * change. `release-on-merge.yml` supplies the first three deliberately: a
   * merge to main that carries a version with no tag yet IS the release
   * decision, and it produces the tag and the dispatch that used to be typed.
   *
   * WHAT DID NOT CHANGE, and is what these assertions are now for:
   *
   *   - `release.yml` is still unreachable from a branch push. It runs on a
   *     `v*` tag or a dispatch, and nothing else. The automation cannot skip a
   *     gate by triggering it a different way, because there is no other way.
   *   - The publish job is still gated on both inputs, so a tag push alone —
   *     including one somebody pushes by hand — proves and stops.
   *   - The `npm-publish` environment still stands between the dispatch and the
   *     registry. That gate belongs to a person, and with the first three
   *     automated it is now the only one that does.
   *
   * An ORDINARY merge still publishes nothing: `release-on-merge.yml` acts only
   * when the version has moved, which the suite below asserts is the condition
   * it actually reads.
   */
  it("cannot be triggered into publishing by a branch push", () => {
    const text = withoutComments(raw())
    expect(text).toMatch(/tags:\n\s*- "v\*"/)
    expect(text).toMatch(/workflow_dispatch:/)
    expect(text, "release.yml triggers on a branch push").not.toMatch(/branches: \[main\]/)
  })

  it("gates publication behind an explicit opt-in AND a typed confirmation", () => {
    // A boolean alone is one mis-click. The phrase is what makes the dispatch
    // an act rather than an accident, and a tag push supplies neither input.
    const text = withoutComments(raw())
    expect(text, "the publish job is not gated on inputs.publish").toMatch(/inputs\.publish/)
    expect(text, "the publish job takes no confirmation phrase").toMatch(
      /inputs\.confirm == '[^']+'/,
    )
    expect(text, "release.yml declares no confirm input").toMatch(/confirm:/)
  })

  it("runs publication inside a protected environment on a GitHub-hosted runner", () => {
    const text = withoutComments(raw())
    // `\n  publish:` and not `  publish:` — the latter also matches the
    // `publish:` workflow_dispatch INPUT, which is indented further.
    const at = text.indexOf("\n  publish:")
    expect(at, "release.yml has no publish job").toBeGreaterThan(-1)
    const job = text.slice(at, at + 900)
    // The environment is where required reviewers live — the one gate that
    // belongs to a person rather than to this file.
    expect(job, "the publish job is not bound to the npm-publish environment").toMatch(
      /environment: npm-publish/,
    )
    // Provenance is refused on a self-hosted runner.
    expect(job, "the publish job does not run on a GitHub-hosted Linux runner").toMatch(
      /runs-on: ubuntu-/,
    )
  })

  it("publishes both packages with provenance, public access, flowcms first", () => {
    const text = raw()
    const publishes = [...text.matchAll(/run: npm publish[^\n]*/g)]
    expect(publishes.length, "release.yml has no publish step").toBe(2)
    for (const match of publishes) {
      expect(match[0], "a publish step drops --provenance or --access public").toMatch(
        /--provenance/,
      )
      expect(match[0]).toMatch(/--access public/)
    }
    // Order is not cosmetic: create-flowcms ships documentation pointing theme
    // authors at `flowcms`, so a scaffolder published first documents a package
    // that does not exist.
    const first = text.indexOf("working-directory: packages/flowcms")
    const second = text.indexOf("working-directory: packages/create-flowcms")
    expect(first, "flowcms is not published from its own directory").toBeGreaterThan(-1)
    expect(second, "create-flowcms is not published from its own directory").toBeGreaterThan(-1)
    expect(first, "create-flowcms is published before flowcms").toBeLessThan(second)
  })

  it("carries no npm publish credential at all", () => {
    /**
     * The predecessor of this assertion permitted exactly two occurrences of
     * NODE_AUTH_TOKEN, one per publish step, and checked they were not echoed.
     * That was the right shape for a token-authenticated publish. There is no
     * token now: the npm CLI exchanges the job's OIDC identity for a
     * short-lived credential it never writes down.
     *
     * Counting to zero is a much stronger property than counting to two, so
     * this asserts absence rather than scope. There is nothing here to leak,
     * which means there is nothing here to review the handling of.
     */
    const raw_ = raw() // comments included: not even the prose may name one
    expect(raw_, "release.yml references an npm publish token").not.toMatch(/NPM_TOKEN/)
    expect(raw_, "release.yml sets an npm auth token for publishing").not.toMatch(
      /NODE_AUTH_TOKEN/,
    )

    const text = withoutComments(raw_)
    // The remaining ways a credential leaks into a log.
    expect(text, "npm auth configuration is dumped to the log").not.toMatch(/npm config list/)
    expect(text, "an .npmrc is written by hand").not.toMatch(/_authToken/)

    // The publish steps carry FLOWCMS_RELEASE and nothing else. An env block
    // that grew a second entry would be the first sign of a token returning.
    for (const step of publishSteps(text).filter((s) => /run: npm publish\b/.test(s.body))) {
      const env = [...step.body.matchAll(/^ {10}([A-Z_][A-Z0-9_]*):/gm)].map((m) => m[1])
      expect(env, `${step.name} passes more than FLOWCMS_RELEASE`).toEqual(["FLOWCMS_RELEASE"])
    }
  })

  it("authenticates publication through OIDC rather than a stored credential", () => {
    const text = withoutComments(raw())
    const steps = publishSteps(text)

    // The CLI that performs the exchange, pinned. Its narrowness is asserted in
    // the least-privilege suite; what matters here is that it runs BEFORE the
    // publish steps, since the bundled npm cannot do the exchange at all.
    const pin = steps.find((step) => /npm install -g npm@/.test(step.body))
    expect(pin, "release.yml never installs an npm CLI that can do the OIDC exchange").toBeDefined()
    const firstPublish = text.search(/run: npm publish\b/)
    expect(firstPublish, "release.yml has no publish step").toBeGreaterThan(-1)
    expect(pin?.at, "the npm CLI is pinned after publication has begun").toBeLessThan(firstPublish)

    /**
     * THE REGISTRY IS CHOSEN WITHOUT CHOOSING AN AUTH METHOD.
     *
     * This used to assert setup-node's `registry-url`, which was asserting an
     * implementation that actively breaks the thing it sat next to.
     * `registry-url` does not only select a registry: setup-node writes an
     * npmrc carrying an auth entry for it, keyed to an environment variable
     * Trusted Publishing never sets, and points npm at that file. npm then sees
     * a registry already configured for classic token auth and does not begin
     * the OIDC exchange — ENEEDAUTH or E404, from a workflow that looks
     * correct.
     *
     * So the property is inverted. The publish job's setup-node must configure
     * NO registry auth, and the registry must be selected on its own.
     */
    const setup = steps.find((step) => /uses:\s*actions\/setup-node/.test(step.body))
    expect(setup, "the publish job never sets up Node").toBeDefined()
    expect(
      setup?.body,
      "the publish job's setup-node configures registry auth, which shadows the OIDC exchange",
    ).not.toMatch(/registry-url/)
    expect(
      text,
      "release.yml still uses setup-node's registry-url; it writes an auth entry npm will prefer over OIDC",
    ).not.toMatch(/registry-url/)

    // The privileged job takes no restored cache: it is the one that signs and
    // publishes, and a cache is input carried over from an earlier run.
    expect(
      setup?.body,
      "the publish job's setup-node leaves package-manager caching on",
    ).toMatch(/package-manager-cache:\s*false/)

    // The registry is still pinned, by the one key that only selects a
    // registry, and the job verifies it took effect rather than assuming it.
    const registry = steps.find((step) => /npm config set registry/.test(step.body))
    expect(registry, "the publish job never pins the registry it publishes to").toBeDefined()
    expect(registry?.body, "the registry is pinned to something other than the public npm").toMatch(
      /npm config set registry https:\/\/registry\.npmjs\.org\/?\b/,
    )
    expect(
      registry?.body,
      "the pinned registry is set but never verified to have taken effect",
    ).toMatch(/npm config get registry/)
    expect(registry?.at, "the registry is pinned after publication has begun").toBeLessThan(
      firstPublish,
    )

    // No classic login path may exist alongside the exchange.
    expect(text, "release.yml logs in to npm with a stored credential").not.toMatch(
      /npm\s+(login|adduser|add-user)\b/,
    )

    // Trusted publishing is bound by npm to this workflow FILENAME and this
    // environment. Neither is decoration: change either and the registry
    // refuses the publish, so both are pinned as release policy.
    expect(FILES, "the release workflow was renamed; npm's trust binding names it").toContain(
      "release.yml",
    )
    expect(text, "the publish job left the npm-publish environment").toMatch(
      /environment: npm-publish/,
    )
  })

  it("scopes id-token: write to the publish job alone", () => {
    const text = withoutComments(raw())
    const grants = [...text.matchAll(/id-token: write/g)]
    expect(grants.length, "id-token: write is granted more than once").toBe(1)
    const at = text.indexOf("\n  publish:")
    expect(grants[0].index, "id-token: write is granted outside the publish job").toBeGreaterThan(
      at,
    )
  })

  it("asserts the package-level publish guards are still in place", () => {
    // The guards are no longer absolute blockers, but they must still exist and
    // still run: they validate licence, repository metadata and built artifacts
    // at the moment of publishing.
    expect(raw()).toMatch(/publish-guard\.mjs/)
    expect(raw()).toMatch(/prepublishOnly/)
  })

  it("checks the packages that must never be published are still private", () => {
    const text = raw()
    expect(text, "release.yml no longer checks that non-targets stay private").toMatch(
      /"private": true/,
    )
    expect(text).toMatch(/flowcms-theme-aurora/)
  })

  /**
   * The release-target preflight, located structurally: the step that queries
   * the registry ABOUT THE PACKAGES. Naming the registry is not enough to
   * identify it — setting up Node and pinning the registry both mention the
   * same host — so the manifest it reads is what distinguishes it.
   */
  const preflightStep = (text: string) =>
    publishSteps(text).find(
      (step) =>
        /registry\.npmjs\.org/.test(step.body) &&
        /packages\/flowcms/.test(step.body) &&
        !/uses:\s*actions\/setup-node/.test(step.body),
    )

  it("refuses to publish on any registry answer it cannot interpret", () => {
    /**
     * THE DEFECT THIS PINS, and it outlived the gate it was written for.
     *
     * The obvious way to ask the registry anything —
     *
     *     if npm view "$name" >/dev/null 2>&1; then ...; else ...; fi
     *
     * — collapses every distinct failure into one branch. A 404, yes. But
     * equally a DNS failure, a TLS failure, a proxy in front of the runner, a
     * registry outage, a 429, or an npm client that fell over. Those are
     * precisely the conditions under which nobody should be publishing.
     *
     * The property pinned here is not which command is used, and not which
     * answer means "go". It is that exactly one specific answer is interpreted
     * at all, and everything else refuses.
     */
    const text = withoutComments(raw())
    expect(publishSteps(text).length, "release.yml has no publish job with named steps")
      .toBeGreaterThan(0)

    const gate = preflightStep(text)
    expect(gate, "the publish job has no step that queries the npm registry").toBeDefined()
    if (!gate) return

    // Exactly the two names this repository publishes.
    expect(gate.body, "the preflight does not check flowcms").toMatch(/['"]flowcms['"]/)
    expect(gate.body, "the preflight does not check create-flowcms").toMatch(
      /['"]create-flowcms['"]/,
    )

    // A positive control. Without one, a captive proxy answering the same thing
    // to every request is indistinguishable from the registry agreeing with us.
    expect(gate.body, "the preflight has no positive control").toMatch(/['"]react['"]/)

    // Both statuses are handled as distinct, named cases.
    expect(gate.body, "the preflight does not distinguish a 404").toMatch(/===\s*404/)
    expect(gate.body, "the preflight does not distinguish a 200").toMatch(/[!=]==\s*200/)

    // A thrown request must refuse rather than fall through.
    expect(gate.body, "the preflight does not catch a failed request").toMatch(/catch\s*\(/)

    // The shapes that quietly turn a gate back into a rubber stamp.
    expect(gate.body, "the preflight re-introduces the fail-open npm view idiom").not.toMatch(
      /npm view/,
    )
    expect(gate.body, "the preflight swallows its own failure").not.toMatch(/\|\|\s*true/)
    expect(gate.body, "the preflight cannot fail the job").not.toMatch(/continue-on-error/)

    // Public reads. A credential here would be one handed to a step that has
    // nothing to spend it on.
    expect(gate.body, "the preflight is handed a credential").not.toMatch(
      /NODE_AUTH_TOKEN|NPM_TOKEN|_authToken/,
    )
    expect(gate.body, "the preflight declares an environment block").not.toMatch(/^\s*env:/m)

    // And it has to run BEFORE anything is published, not beside it.
    const firstPublish = text.search(/run: npm publish\b/)
    expect(firstPublish, "release.yml has no publish step").toBeGreaterThan(-1)
    expect(gate.at, "the preflight runs after publication has begun").toBeLessThan(firstPublish)
  })

  it("checks the release target, not whether the names are still unclaimed", () => {
    /**
     * THE INVERSION THIS PINS.
     *
     * Before 0.1.0 the preflight asked "are these names still free?" and
     * refused on HTTP 200. Both packages exist now, so that question inverted:
     * 200 is the healthy answer and a 404 means something is wrong. A gate left
     * in its first-publication shape would refuse every release forever, and —
     * worse — a gate half-converted might read a 404 as an invitation.
     *
     * Each assertion below names an invariant rather than an implementation.
     * The step may be rewritten freely; what may not disappear is the set of
     * things it establishes before a version is allowed onto the registry.
     */
    const text = withoutComments(raw())
    const gate = preflightStep(text)
    expect(gate, "the publish job has no release-target preflight").toBeDefined()
    if (!gate) return

    // INVARIANT: the version published is the one in the local manifests, read
    // from disk rather than typed into a dispatch box.
    expect(gate.body, "the preflight never reads the local manifests").toMatch(/package\.json/)
    for (const dir of ["packages/flowcms", "packages/create-flowcms"]) {
      expect(gate.body, `the preflight never reads ${dir}`).toContain(dir)
    }

    // INVARIANT: the two packages are released together, at one version. They
    // are published in sequence, so a disagreement here is how half a release
    // reaches the registry.
    expect(gate.body, "the preflight does not require the two versions to agree").toMatch(
      /new Set|versions\.length/,
    )

    // INVARIANT: publication runs against the tag that names that version, so
    // what reaches the registry is what the tag resolves to. Read from the
    // runner environment, not from an interpolated expression.
    expect(gate.body, "the preflight does not check the ref type").toMatch(/GITHUB_REF_TYPE/)
    expect(gate.body, "the preflight does not check the ref name").toMatch(/GITHUB_REF_NAME/)
    expect(gate.body, "the preflight does not require the tag to be v<version>").toMatch(
      /`v\$\{version\}`|'v' \+ version/,
    )

    // INVARIANT: an already-published version is refused. npm versions are
    // immutable, which is also why v0.1.0 is never re-cut.
    expect(gate.body, "the preflight does not look at the published version list").toMatch(
      /\bversions\b/,
    )
    expect(
      gate.body,
      "the preflight does not refuse a version that already exists on the registry",
    ).toMatch(/hasOwnProperty|\bin body\.versions\b|versions\[version\]/)

    // THE BOOTSTRAP CONCEPT IS GONE. A 404 for one of our packages is now a
    // fault, never a green light, so the vocabulary of availability must not
    // survive in the step that decides whether to publish.
    expect(
      gate.body,
      "the preflight still describes a name as free or available; that concept expired with the first publication",
    ).not.toMatch(/\b(available|is free|unclaimed)\b/i)
  })

  /**
   * THIS TEST USED TO ASSERT THE OPPOSITE, and the reason it did expired.
   *
   * It required `if: ${{ false }}` on the GitHub Release step, because creating
   * the release was "a separate deliberate act, in its own phase". That phase
   * is this workflow now: the release is cut by merging a pull request, and a
   * released version with no release page is a gap somebody would close by
   * hand every time.
   *
   * So the step is enabled, and what is pinned instead is the two properties
   * that make it safe. Both are things a plausible edit would get wrong, and
   * neither is visible from a green run.
   */
  it("creates the GitHub Release last, from the tag, with this version's notes", () => {
    const text = raw()
    const at = text.indexOf("name: Create the GitHub Release")
    expect(at, "release.yml no longer creates a GitHub Release").toBeGreaterThan(-1)

    const step = text.slice(at, at + 600)

    // ORDER. The registry is the irreversible half. A release page created
    // before the publishes could describe a version that never shipped; created
    // after them, the worst case is a missing page.
    const lastPublish = text.lastIndexOf("run: npm publish")
    expect(lastPublish, "release.yml has no publish step").toBeGreaterThan(-1)
    expect(at, "the GitHub Release is created before the packages are published").toBeGreaterThan(
      lastPublish,
    )

    // `--verify-tag` refuses to invent the tag as a side effect. Without it a
    // typo creates a NEW tag on whatever the run's ref happens to be, and the
    // release then names a commit nothing was published from.
    expect(step, "the GitHub Release may create its own tag").toMatch(/--verify-tag\b/)

    // ONE SECTION, NOT THE FILE. The placeholder here was
    // `--notes-file CHANGELOG.md`, which would attach the entire history —
    // every release back to 0.1.0 — to every release page.
    expect(
      step,
      "the release notes are the whole changelog rather than this version's section",
    ).not.toMatch(/--notes-file\s+CHANGELOG\.md\b/)
    expect(step, "the release has no notes file at all").toMatch(/--notes-file\s+\S+/)

    // And the notes file is something this job actually produced.
    const extractAt = text.indexOf("name: Extract this version's changelog section")
    expect(extractAt, "nothing extracts the changelog section the release notes come from")
      .toBeGreaterThan(-1)
    expect(extractAt, "the notes are extracted after the release that uses them").toBeLessThan(at)
    const notes = /--notes-file\s+(\S+)/.exec(step)?.[1]
    expect(
      text.slice(extractAt, at),
      `the extraction step never writes ${notes}`,
    ).toContain(notes!)
  })

  it("runs every tier of the pipeline as the release proof", () => {
    const text = raw()
    for (const called of [
      "./.github/workflows/ci.yml",
      "./.github/workflows/database-matrix.yml",
      "./.github/workflows/consumer-proofs.yml",
      "./.github/workflows/docker.yml",
      "./.github/workflows/portability.yml",
    ]) {
      expect(text, `release.yml does not call ${called}`).toContain(called)
    }
    // The topology matrix is optional everywhere else and mandatory here.
    expect(text).toMatch(/topology: true/)
  })

  it("prints the canonical release-proof plan and never executes it", () => {
    const text = withoutComments(raw())
    // Phase 8.5's orchestrator is the single ordered list of what a release
    // must prove. The workflow parallelises those stages across its tiers and
    // prints the plan beside them, so a stage added to one and not the other is
    // visible in every release summary instead of silently absent.
    expect(text, "release.yml never references scripts/release-proof.mjs").toContain(
      "scripts/release-proof.mjs",
    )
    // Plan mode only. `--execute` would re-run every stage serially, in a job
    // whose `needs:` have already run them.
    expect(text, "release.yml executes the release-proof orchestrator").not.toMatch(
      /release-proof\.mjs[^\n]*--execute/,
    )
  })
})

describe("the merge that cuts the release", () => {
  const raw = () => read(RELEASE_ON_MERGE)

  it("watches main, and only main", () => {
    const text = withoutComments(raw())
    expect(text, "release-on-merge.yml does not trigger on a push to main").toMatch(
      /on:\n\s+push:\n\s+branches:\n\s+- main\b/,
    )
    // A tag trigger here would be a loop: this file creates tags.
    expect(text, "release-on-merge.yml also triggers on a tag").not.toMatch(/tags:/)
    // Nothing about a fork's pull request may reach a job that can push a tag.
    expect(text, "release-on-merge.yml triggers on a pull request").not.toMatch(
      /pull_request(_target)?:/,
    )
  })

  it("publishes nothing itself", () => {
    /**
     * The whole safety argument for this file is that it is a trigger, not a
     * publisher. It holds no registry credential and cannot acquire one: no
     * OIDC identity to exchange, no environment to publish from, no publish
     * step. Everything that reaches the registry stays in release.yml, behind
     * the gates the suite above pins.
     */
    const text = withoutComments(raw())
    expect(text, "release-on-merge.yml runs a publish step").not.toMatch(/\bpublish\b\s+--/)
    expect(text, "release-on-merge.yml asks for the OIDC identity a publish needs").not.toMatch(
      /id-token:\s*write/,
    )
    expect(text, "release-on-merge.yml binds itself to a deployment environment").not.toMatch(
      /^\s+environment:/m,
    )
    expect(text, "release-on-merge.yml reads a repository secret").not.toMatch(/secrets\./)
  })

  it("acts only when the version has moved", () => {
    /**
     * THE PROPERTY THAT KEEPS AN ORDINARY MERGE HARMLESS, and it is a property
     * of this file rather than of a branch name or a commit convention. The
     * decision is "does a tag for the version in the tree already exist"; every
     * step with a side effect is gated on the answer.
     */
    const text = withoutComments(raw())

    expect(text, "the decision step does not look for an existing tag").toMatch(
      /git rev-parse[^\n]*refs\/tags\//,
    )
    expect(text, "the decision is not published as a step output").toMatch(
      /release=false[^\n]*GITHUB_OUTPUT|echo "release=false" >> "\$GITHUB_OUTPUT"/,
    )

    // Every step that writes something — the tag, the dispatch — carries the
    // gate. A step that lost its `if:` would act on every merge to main.
    const guarded = /if: steps\.decide\.outputs\.release == 'true'/g
    const gates = text.match(guarded) ?? []
    expect(
      gates.length,
      "fewer guarded steps than the four that must not run on an ordinary merge",
    ).toBeGreaterThanOrEqual(4)

    for (const step of ["Create and push the annotated tag", "Dispatch the release workflow"]) {
      const at = text.indexOf(`- name: ${step}`)
      expect(at, `release-on-merge.yml has no "${step}" step`).toBeGreaterThan(-1)
      expect(
        text.slice(at, at + 200),
        `"${step}" is not gated on the version having moved`,
      ).toMatch(guarded)
    }
  })

  it("proves the version and the changelog before it creates the tag", () => {
    /**
     * Order matters more here than anywhere else in the pipeline. A tag is
     * immutable in practice — it is what provenance resolves back to — so the
     * checks that could refuse a release have to run BEFORE it exists, not
     * after. A gate below the tag would leave a tag naming a release that never
     * happened.
     */
    const text = withoutComments(raw())
    const sync = text.indexOf("scripts/release-version-sync.mjs")
    const changelog = text.indexOf("CHANGELOG.md")
    const tag = text.indexOf("git tag -a")

    expect(sync, "release-on-merge.yml never checks that the version sources agree")
      .toBeGreaterThan(-1)
    expect(changelog, "release-on-merge.yml never checks the changelog").toBeGreaterThan(-1)
    expect(tag, "release-on-merge.yml creates no annotated tag").toBeGreaterThan(-1)

    expect(sync, "the version-sources check runs after the tag is created").toBeLessThan(tag)
    expect(changelog, "the changelog check runs after the tag is created").toBeLessThan(tag)
  })

  it("creates a tag and never moves one", () => {
    const text = withoutComments(raw())
    // Annotated, because that is what the release procedure has always created
    // and what the tag object's date and author are read from.
    expect(text, "the tag is lightweight").toMatch(/git tag -a\b/)
    // A published version's tag is immutable. Force-pushing one would silently
    // repoint what provenance resolves to.
    expect(text, "release-on-merge.yml can force-update a tag").not.toMatch(
      /git (tag|push)[^\n]*(--force|-f\b)/,
    )
    expect(text, "release-on-merge.yml can delete a tag").not.toMatch(/git (tag -d|push[^\n]*:refs)/)
  })

  it("dispatches release.yml with exactly the inputs that workflow demands", () => {
    /**
     * THE TYPO THIS CATCHES. `release.yml`'s publish job is gated on a literal
     * phrase. A dispatch supplying anything else runs the proof tiers, reports
     * green, and publishes nothing — the release simply does not happen, and it
     * does not happen quietly. So the phrase is read out of release.yml rather
     * than written twice.
     */
    const merge = withoutComments(raw())
    const release = withoutComments(read(RELEASE))

    const phrase = release.match(/inputs\.confirm == '([^']+)'/)?.[1]
    expect(phrase, "release.yml declares no confirmation phrase to match").toBeTruthy()

    expect(merge, "release-on-merge.yml does not dispatch release.yml").toMatch(
      /gh workflow run release\.yml/,
    )
    expect(merge, "the dispatch does not opt in to publishing").toMatch(/-f publish=true/)
    expect(
      merge,
      `the dispatch does not supply the phrase release.yml requires (${phrase})`,
    ).toContain(`confirm='${phrase}'`)

    // Against the tag it just created, not against main. release.yml's
    // preflight refuses a non-tag ref, so this is what makes the dispatch
    // reach the publish rather than fail at the first gate.
    expect(merge, "the dispatch does not target the tag").toMatch(
      /--ref "\$TAG"|--ref \$\{\{ steps\.decide\.outputs\.tag \}\}/,
    )
  })
})

describe("depth is an input, never the caller's event", () => {
  /**
   * THE DEFECT THIS PINS.
   *
   * Inside a called workflow, `github.event_name` is the CALLER's event. A
   * release cut from a `v*` tag therefore reports `push`, so an expensive job
   * guarded by `if: github.event_name != 'push'` skips itself during the one
   * run that must skip nothing — and it does it silently, reporting green.
   *
   * The fix is a declared boolean input the caller passes explicitly, which is
   * what `database-matrix.yml` already did with `topology`.
   */
  const DEPTH_GATED = ["docker.yml", "consumer-proofs.yml", "portability.yml"] as const

  it.each(DEPTH_GATED)("%s declares a `full` input on workflow_call", (file) => {
    const source = withoutComments(read(file))
    const callAt = source.indexOf("workflow_call:")
    expect(callAt, `${file} is not callable`).toBeGreaterThan(-1)
    expect(source.slice(callAt, callAt + 400), `${file} takes no depth input`).toMatch(
      /inputs:\s*\n\s+full:/,
    )
  })

  it.each(DEPTH_GATED)("%s is passed its depth explicitly by release.yml", (file) => {
    const release = withoutComments(read(RELEASE))
    const at = release.indexOf(`./.github/workflows/${file}`)
    expect(at, `release.yml does not call ${file}`).toBeGreaterThan(-1)
    expect(release.slice(at, at + 300), `release.yml calls ${file} at the default depth`).toMatch(
      /full: true/,
    )
  })

  it.each([...DEPTH_GATED, "database-matrix.yml"])(
    "%s gates no job on the caller's event name",
    (file) => {
      const source = withoutComments(read(file))
      for (const line of source.match(/^\s*if:.*$/gm) ?? []) {
        // `!= 'pull_request'` is safe: a called workflow is never invoked from
        // one here, and reading it as "not a PR" stays true. Comparing against
        // `push` or `schedule` is what produces the wrong answer for a caller.
        expect(line, `${file}: ${line.trim()} reads the caller's event`).not.toMatch(
          /github\.event_name\s*(==|!=)\s*'(push|workflow_dispatch)'/,
        )
      }
    },
  )
})

describe("portability", () => {
  const source = () => withoutComments(read("portability.yml"))

  it("keeps both OS legs running when one fails", () => {
    // The entire point of two runner classes is to learn whether a failure is
    // OS-specific. `fail-fast: true` cancels the second leg at exactly the
    // moment its result would answer that.
    const text = source()
    const matrices = (text.match(/strategy:/g) ?? []).length
    expect(matrices, "portability.yml declares no matrix").toBeGreaterThan(0)
    expect((text.match(/fail-fast: false/g) ?? []).length).toBe(matrices)
  })

  it("covers Windows and macOS and leaves Linux to ci.yml", () => {
    const text = source()
    expect(text).toMatch(/windows-/)
    expect(text).toMatch(/macos-/)
    // Repeating the Linux suite here would pay for `build:packages`,
    // `build:template` and ~1900 tests twice on every pull request.
    expect(text, "portability.yml repeats the Linux suite ci.yml already runs").not.toMatch(
      /os:\s*\[[^\]]*ubuntu/,
    )
  })

  it("runs the package-manager matrix on Linux only", () => {
    // Docker needs a Linux runner, and a manager's behaviour differs far more
    // between managers than between operating systems. A manager x OS grid
    // would re-prove the same differences three times.
    const text = source()
    const at = text.indexOf("verify-package-manager-matrix.mjs")
    expect(at, "the manager matrix is not invoked").toBeGreaterThan(-1)
    const job = text.lastIndexOf("runs-on:", at)
    expect(text.slice(job, job + 40)).toMatch(/ubuntu-/)
  })

  it("names each manager it claims to prove", () => {
    // docs/distribution/package-managers.md's support levels are downstream of
    // this list. A silently narrowed `--managers` would leave the document
    // claiming evidence the job stopped producing.
    expect(source()).toMatch(/--managers pnpm,yarn,bun/)
  })

  it("installs pnpm and yarn through corepack rather than a third-party action", () => {
    const text = source()
    expect(text).toMatch(/corepack enable/)
    // corepack prompts before its first download; a prompt on a runner with no
    // stdin is a hang, not a question.
    expect(text).toMatch(/COREPACK_ENABLE_DOWNLOAD_PROMPT/)
  })
})

describe("the expensive gates are wired to something", () => {
  const all = () => FILES.map(read).join("\n")

  it.each([
    ["scripts/verify-package-consumer.mjs", "the clean theme-consumer proof"],
    ["scripts/verify-create-flowcms.mjs", "the clean application proof"],
    ["scripts/verify-artifact-hygiene.mjs", "the artifact leak gate"],
    ["scripts/ci/assert-linux-lockfile.mjs", "the lockfile platform gate"],
    ["scripts/ci/assert-theme-tracing.mjs", "the package-theme build proof"],
    ["scripts/db-matrix.sh", "the compose topology proof"],
    ["scripts/verify-package-manager-matrix.mjs", "the pnpm/yarn/bun matrix"],
    ["scripts/release-proof.mjs", "the canonical release-proof plan"],
  ])("%s is invoked by a workflow — %s", (script) => {
    expect(all()).toContain(script)
  })

  it("runs the theme-package build proof against a real production build", () => {
    const consumers = read("consumer-proofs.yml")
    expect(consumers).toMatch(/FLOWCMS_INTEGRATION_THEMES/)
    expect(consumers).toMatch(/npm run build/)
  })
})
