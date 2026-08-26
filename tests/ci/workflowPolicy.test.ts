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

  it("scopes the release workflow's elevated permissions to the publish job", () => {
    const source = withoutComments(read(RELEASE))
    const publishAt = source.indexOf("\n  publish:")
    expect(publishAt, "release.yml has no publish job").toBeGreaterThan(-1)

    for (const key of ["contents", "id-token"]) {
      const at = source.search(new RegExp(`^\\s+${key}: write\\b`, "m"))
      expect(at, `release.yml never asks for ${key}: write`).toBeGreaterThan(-1)
      expect(at, `${key}: write is declared outside the publish job`).toBeGreaterThan(publishAt)
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

  it("carries the PUBLISHING_BLOCKED marker", () => {
    // The marker a human must delete, deliberately, in a commit with their name
    // on it. If this test ever fails, publication was unblocked — confirm that
    // was a decision and not a merge accident.
    expect(raw()).toMatch(/PUBLISHING_BLOCKED/)
  })

  it("fails hard rather than skipping when publication is requested", () => {
    const text = raw()
    const at = text.indexOf("name: PUBLISHING_BLOCKED")
    expect(at, "the guard step is missing").toBeGreaterThan(-1)
    const guard = text.slice(at, at + 2500)
    expect(guard).toMatch(/exit 1/)
    expect(guard, "the guard is allowed to fail softly").not.toMatch(/continue-on-error/)
  })

  it("leaves every registry-reaching step unreachable a second time", () => {
    const text = raw()
    const publishes = [...text.matchAll(/run: npm publish/g)]
    expect(publishes.length, "release.yml has no publish step to guard").toBeGreaterThan(0)
    for (const match of publishes) {
      const preceding = text.slice(Math.max(0, match.index - 400), match.index)
      expect(preceding, "a publish step is not guarded by `if: ${{ false }}`").toMatch(
        /if:\s*\$\{\{\s*false\s*\}\}/,
      )
    }
  })

  it("does not publish merely because code reached main", () => {
    const text = withoutComments(raw())
    expect(text).toMatch(/tags:\n\s*- "v\*"/)
    expect(text).toMatch(/workflow_dispatch:/)
    expect(text, "release.yml triggers on a branch push").not.toMatch(/branches: \[main\]/)
  })

  it("gates the publish job behind an explicit opt-in input", () => {
    expect(withoutComments(raw())).toMatch(/if: \$\{\{ inputs\.publish \}\}/)
  })

  it("asserts the package-level publish guards are still in place", () => {
    const text = raw()
    expect(text).toMatch(/publish-guard\.mjs/)
    expect(text).toMatch(/"private": true/)
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
