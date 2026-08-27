import { describe, expect, it } from "vitest"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * THE CI POLICY, PINNED.
 *
 * Workflow files are the one part of this repository that cannot be exercised
 * by running it. They execute on GitHub, on a push, in an environment nobody
 * has locally — so the properties that matter most about them (least
 * privilege, no publishing, no secret in the YAML) are exactly the properties
 * nothing otherwise checks.
 *
 * This suite reads them as TEXT rather than parsed YAML, deliberately. Parsing
 * would need a YAML library this repository does not depend on, and the
 * assertions worth making here are about what a reviewer would see in a diff:
 * a literal `contents: write`, a literal `@main`, a literal token.
 *
 * It cannot verify that a workflow RUNS. No workflow in this repository has
 * ever run. It verifies the policy the workflows are supposed to encode, which
 * is the part that stays true regardless of whether one has executed yet.
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
    [RELEASE, "the release proof and the blocked publish job"],
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

  it("grants a write permission only in the release workflow", () => {
    for (const file of FILES) {
      if (file === RELEASE) continue
      const source = withoutComments(read(file))
      const writes = source.match(/^\s*[a-z-]+:\s*write\b/gm) ?? []
      expect(writes, `${file} asks for a write permission`).toEqual([])
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

  it.each(FILES)("%s installs with `npm ci`, never `npm install`", (file) => {
    const source = withoutComments(read(file)).replace(packedFixtureInstall(), "«packed-fixture»")
    expect(
      source,
      `${file} uses npm install; the lockfile would be rewritten silently instead of enforced`,
    ).not.toMatch(/\bnpm\s+install\b/)
    if (/\bnpm\b/.test(source)) expect(source).toMatch(/npm ci\b/)
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

  it("generates its ephemeral secrets rather than reading repository secrets", () => {
    for (const file of FILES) {
      const source = withoutComments(read(file))
      for (const ref of source.match(/secrets\.[A-Z_]+/g) ?? []) {
        // The single permitted reference is a name that does not exist yet, in
        // the blocked publish job.
        expect(ref, `${file} reads ${ref}`).toBe("secrets.NPM_TOKEN")
        expect(file, `${ref} is referenced outside the release workflow`).toBe(RELEASE)
      }
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
})

describe("release safety", () => {
  const raw = () => read(RELEASE)

  /**
   * The publish job's steps, in order, each bounded to its own text.
   *
   * Bounding matters: several assertions below are about what a step does NOT
   * contain, and a search across the whole file would find the thing in some
   * other step and pass for the wrong reason. `registry.npmjs.org`, for one,
   * appears both in the setup-node registry-url and in the availability gate.
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

  // Publication is no longer blocked outright — the bootstrap release path is
  // live. What these assert is that it stays DELIBERATE: four independent
  // things must line up before anything reaches the registry, and none of them
  // is something an ordinary push or a merge can supply.

  it("does not publish merely because code reached main", () => {
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

  it("keeps the npm token out of everything except the publish commands", () => {
    const text = withoutComments(raw())
    const uses = [...text.matchAll(/NODE_AUTH_TOKEN/g)]
    // Exactly the two publish steps. A workflow-level or job-level env block
    // would hand the token to every step, including third-party actions.
    expect(uses.length, "NODE_AUTH_TOKEN appears somewhere other than the two publish steps").toBe(
      2,
    )
    expect(text, "the token is echoed or summarised").not.toMatch(
      /echo[^\n]*(NODE_AUTH_TOKEN|NPM_TOKEN)/,
    )
    expect(text, "npm auth configuration is dumped to the log").not.toMatch(/npm config list/)
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

  it("gates publication on a fail-closed registry check of both package names", () => {
    /**
     * THE DEFECT THIS PINS.
     *
     * The obvious way to ask whether a name is free —
     *
     *     if npm view "$name" >/dev/null 2>&1; then taken; else available; fi
     *
     * — reads EVERY failure as proof the name is free. A 404, yes. But equally
     * a DNS failure, a TLS failure, a proxy in front of the runner, a registry
     * outage, a 429, or an npm client that fell over. Those are precisely the
     * conditions under which nobody should be publishing, and that shape waves
     * all of them through while printing a reassuring "available".
     *
     * So the property worth pinning is not which command is used. It is that
     * only an authoritative 404 is read as available, and that everything else
     * — including the registry being unreachable — refuses.
     */
    const text = withoutComments(raw())
    const steps = publishSteps(text)
    expect(steps.length, "release.yml has no publish job with named steps").toBeGreaterThan(0)

    // The gate is the step that talks to the registry itself, not the one that
    // merely points npm at it.
    const gate = steps.find(
      (step) =>
        /registry\.npmjs\.org/.test(step.body) && !/uses:\s*actions\/setup-node/.test(step.body),
    )
    expect(gate, "the publish job has no step that queries the npm registry").toBeDefined()
    if (!gate) return

    // Exactly the two names this repository may publish.
    expect(gate.body, "the availability gate does not check flowcms").toMatch(/['"]flowcms['"]/)
    expect(gate.body, "the availability gate does not check create-flowcms").toMatch(
      /['"]create-flowcms['"]/,
    )

    // A positive control. Without one, a captive proxy answering 404 to
    // everything reads as two free names and the publication proceeds.
    expect(gate.body, "the availability gate has no positive control").toMatch(/['"]react['"]/)

    // 404 is the only answer that means available; 200 means the name is taken.
    expect(gate.body, "the availability gate does not distinguish a 404").toMatch(/===\s*404/)
    expect(gate.body, "the availability gate does not distinguish a 200").toMatch(/===\s*200/)

    // A thrown request must refuse rather than fall through to available.
    expect(gate.body, "the availability gate does not catch a failed request").toMatch(
      /catch\s*\(/,
    )

    // The three shapes that quietly turn a gate back into a rubber stamp.
    expect(gate.body, "the availability gate re-introduces the fail-open npm view idiom").not.toMatch(
      /npm view/,
    )
    expect(gate.body, "the availability gate swallows its own failure").not.toMatch(/\|\|\s*true/)
    expect(gate.body, "the availability gate cannot fail the job").not.toMatch(
      /continue-on-error/,
    )

    // Public reads. Nothing here needs to prove who it is, and a token in this
    // step's environment would be a token handed to a step that never spends it.
    expect(gate.body, "the availability gate is handed an npm token").not.toMatch(
      /NODE_AUTH_TOKEN|NPM_TOKEN/,
    )
    expect(gate.body, "the availability gate declares an environment block").not.toMatch(
      /^\s*env:/m,
    )

    // And it has to run BEFORE anything is published, not beside it.
    const firstPublish = text.search(/run: npm publish\b/)
    expect(firstPublish, "release.yml has no publish step").toBeGreaterThan(-1)
    expect(gate.at, "the availability gate runs after publication has begun").toBeLessThan(
      firstPublish,
    )
  })

  it("leaves the GitHub Release step unreachable until it is deliberately enabled", () => {
    const text = raw()
    const at = text.indexOf("name: Create the GitHub Release")
    if (at === -1) return // not prepared yet, which is also a valid state
    expect(
      text.slice(at, at + 300),
      "the GitHub Release step is reachable before anyone enabled it",
    ).toMatch(/if:\s*\$\{\{\s*false\s*\}\}/)
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
