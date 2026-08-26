import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { applyDefaults, validateConfig } from "../../packages/create-flowcms/src/config/validate.mjs"
import { generateSecrets } from "../../packages/create-flowcms/src/config/secrets.mjs"
import {
  EnvValueError,
  serializeEnvFile,
  serializeEnvValue,
} from "../../packages/create-flowcms/src/render/env.mjs"
import { buildEnvFile } from "../../packages/create-flowcms/src/render/envFile.mjs"
import {
  composeEnvFor,
  composeFilesFor,
  composeProfilesFor,
  overlaysToRemove,
} from "../../packages/create-flowcms/src/render/compose.mjs"
import {
  LOCKFILES,
  installCommandFor,
  needsCorepack,
  renderDockerfile,
  renderPackageManagerBlock,
} from "../../packages/create-flowcms/src/render/dockerfile.mjs"
import { buildProjectMarker } from "../../packages/create-flowcms/src/render/marker.mjs"
import { buildReadme } from "../../packages/create-flowcms/src/render/readme.mjs"

/**
 * RENDERING a validated configuration into files.
 *
 * Every renderer is a pure function, so all of this runs without a filesystem.
 * What is being pinned is the set of mistakes that would be discovered late and
 * expensively: a secret in a committed file, an env line that becomes two
 * lines, a Compose topology with two databases in it, a Docker install command
 * for the wrong package manager.
 */

function config(overrides: Record<string, unknown> = {}) {
  const partial = applyDefaults({ projectName: "my-site", ...overrides })
  return validateConfig({ ...partial, secrets: generateSecrets(partial) })
}

describe("the env serializer", () => {
  it("leaves a simple value bare", () => {
    expect(serializeEnvValue("DATABASE_DIALECT", "sqlite")).toBe("DATABASE_DIALECT=sqlite")
  })

  it("quotes a value a parser would read differently", () => {
    expect(serializeEnvValue("NAME", "two words")).toBe('NAME="two words"')
    expect(serializeEnvValue("NAME", "has#hash")).toBe('NAME="has#hash"')
  })

  it("escapes quotes, backslashes and dollars inside a quoted value", () => {
    // `$` matters because Compose performs its own interpolation on env values.
    expect(serializeEnvValue("P", 'a"b')).toBe('P="a\\"b"')
    expect(serializeEnvValue("P", "a\\b")).toBe('P="a\\\\b"')
    expect(serializeEnvValue("P", "a$b")).toBe('P="a\\$b"')
  })

  it("REFUSES a newline rather than escaping it", () => {
    // A newline in a dotenv value is not a malformed value, it is a second
    // line — and a second line is a variable nobody wrote. There is no FlowCMS
    // value that legitimately contains one.
    expect(() => serializeEnvValue("SECRET", "value\nINJECTED=1")).toThrow(EnvValueError)
    expect(() => serializeEnvValue("SECRET", "value\r\nINJECTED=1")).toThrow(EnvValueError)
    expect(() => serializeEnvValue("SECRET", "value\u0000")).toThrow(EnvValueError)
  })

  it("names the key in the error and never the value", () => {
    try {
      serializeEnvValue("S3_SECRET_ACCESS_KEY", "hunter2\nX=1")
      throw new Error("expected a refusal")
    } catch (error) {
      expect((error as Error).message).toContain("S3_SECRET_ACCESS_KEY")
      expect((error as Error).message).not.toContain("hunter2")
    }
  })

  it("omits an entry whose value is null", () => {
    const text = serializeEnvFile([{ title: "T", entries: [["A", "1"], ["B", null]] }])
    expect(text).toContain("A=1")
    expect(text).not.toContain("B=")
  })

  it("drops a section that would be empty", () => {
    expect(serializeEnvFile([{ title: "Empty", entries: [["A", null]] }])).toBe("\n")
  })
})

describe("the generated .env", () => {
  it("carries the four generated secrets", () => {
    const text = buildEnvFile(config())
    for (const key of ["AUTH_SECRET", "CAPTCHA_SECRET", "PREVIEW_SECRET", "FLOWCMS_SETUP_TOKEN"]) {
      expect(text).toMatch(new RegExp(`^${key}=`, "m"))
    }
  })

  it("writes exactly one database URL, with no commented alternatives", () => {
    const text = buildEnvFile(config({ database: "postgresql" }))
    const urls = text.split("\n").filter((line) => /^\s*#?\s*DATABASE_URL=/.test(line))
    expect(urls).toHaveLength(1)
    expect(urls[0].startsWith("#")).toBe(false)
  })

  it("always writes an explicit dialect", () => {
    expect(buildEnvFile(config({ database: "mariadb" }))).toMatch(/^DATABASE_DIALECT=mariadb$/m)
  })

  it("names the Compose files so `docker compose up -d` needs no flags", () => {
    const text = buildEnvFile(config({ database: "postgresql" }))
    expect(text).toMatch(/^COMPOSE_FILE=compose\.yml:compose\.postgres\.yml$/m)
    expect(text).toMatch(/^COMPOSE_PATH_SEPARATOR=:$/m)
  })

  /**
   * TWO SITES ON ONE HOST MUST NOT SHARE VOLUMES.
   *
   * `compose.yml` carries `name: flowcms`. Without an override, a staging copy
   * beside a production one shares container names, networks and volumes: the
   * second `docker compose up -d` recreates the first's containers, and either
   * project's `down -v` deletes the other's database. Nothing warns, and the
   * data is gone.
   *
   * This was found by running two generated stacks at once during Phase 7
   * verification, which is the only way it shows up — one project at a time
   * looks perfect.
   */
  it("gives each site its own Compose project, so two sites cannot share volumes", () => {
    const text = buildEnvFile(config({ projectName: "staging-site" }))
    expect(text).toMatch(/^COMPOSE_PROJECT_NAME=staging-site$/m)
  })

  it("narrows a project name to what Compose accepts", () => {
    // npm allows dots; Compose does not. A name it refuses would make every
    // compose command in the generated project fail.
    expect(composeEnvFor(config({ projectName: "site.example.com" })).COMPOSE_PROJECT_NAME).toBe(
      "site-example-com",
    )
    expect(composeEnvFor(config({ projectName: "_leading" })).COMPOSE_PROJECT_NAME).toBe("leading")
    for (const name of ["site.example.com", "_leading", "my_site", "a-b-c"]) {
      expect(composeEnvFor(config({ projectName: name })).COMPOSE_PROJECT_NAME).toMatch(
        /^[a-z0-9][a-z0-9_-]*$/,
      )
    }
  })

  it("writes no Compose variables for a local deployment", () => {
    const text = buildEnvFile(config({ deploymentMode: "local", storage: "s3", externalStorage: EXTERNAL }))
    expect(text).not.toMatch(/COMPOSE_FILE/)
    expect(text).not.toMatch(/COMPOSE_PROJECT_NAME/)
  })

  it("writes BASE_URL in Docker and NEXT_PUBLIC_BASE_URL locally", () => {
    // compose.yml maps BASE_URL onto the application's NEXT_PUBLIC_BASE_URL; a
    // local process reads the application's variable directly.
    expect(buildEnvFile(config())).toMatch(/^BASE_URL=/m)
    const local = buildEnvFile(config({ deploymentMode: "local", storage: "s3", externalStorage: EXTERNAL }))
    expect(local).toMatch(/^NEXT_PUBLIC_BASE_URL=/m)
  })

  it("never sets the integration-theme gate", () => {
    // An operator's Appearance screen must not contain a fixture theme.
    expect(buildEnvFile(config())).not.toContain("FLOWCMS_INTEGRATION_THEMES")
  })

  it("never writes the internal admin route", () => {
    expect(buildEnvFile(config({ adminPath: "/control" }))).toMatch(/^FLOWCMS_ADMIN_PATH=\/control$/m)
    expect(buildEnvFile(config())).not.toContain("/admin-panel")
  })

  it("refuses the injection at the validation layer, before any rendering", () => {
    // The FIRST of two guards. It names the field rather than the variable,
    // because at this point the operator is thinking about the answer they
    // typed and not about the file it will become.
    expect(() =>
      config({
        deploymentMode: "local",
        storage: "s3",
        externalStorage: { ...EXTERNAL, bucket: "b\nAUTH_SECRET=stolen" },
      }),
    ).toThrow(/bucket/)
  })

  it("refuses to render a value carrying an env-line injection", () => {
    // The SECOND guard, and the reason this test plants the value AFTER
    // validation rather than through it: `config()` refuses a control
    // character in an S3 field, so a hostile value routed through it never
    // reaches the serializer and this test would pass without ever proving
    // the serializer refuses anything. A field added later without its own
    // check is exactly this shape.
    const valid = config({
      deploymentMode: "local",
      storage: "s3",
      externalStorage: EXTERNAL,
    })
    const hostile = {
      ...valid,
      externalStorage: { ...EXTERNAL, bucket: "b\nAUTH_SECRET=stolen" },
    }

    expect(() => buildEnvFile(hostile)).toThrow(EnvValueError)
  })
})

describe("compose selection", () => {
  it("uses the base file alone for SQLite with Garage", () => {
    expect(composeFilesFor(config())).toEqual(["compose.yml"])
  })

  it.each([
    ["postgresql", "compose.postgres.yml"],
    ["mysql", "compose.mysql.yml"],
    ["mariadb", "compose.mariadb.yml"],
  ])("adds exactly one overlay for %s", (database, overlay) => {
    const files = composeFilesFor(config({ database }))
    expect(files).toEqual(["compose.yml", overlay])
  })

  it("never selects two database overlays", () => {
    for (const database of ["sqlite", "postgresql", "mysql", "mariadb"]) {
      const overlays = composeFilesFor(config({ database })).filter((file) =>
        /postgres|mysql|mariadb/.test(file),
      )
      expect(overlays.length).toBeLessThanOrEqual(1)
    }
  })

  it("disables Garage when external storage is chosen", () => {
    const files = composeFilesFor(config({ storage: "s3", externalStorage: EXTERNAL }))
    expect(files).toContain("compose.external-s3.yml")
  })

  it("activates the redis profile only when the bundled service is chosen", () => {
    expect(composeProfilesFor(config({ redis: "bundled" }))).toEqual(["redis"])
    expect(composeProfilesFor(config())).toEqual([])
    expect(composeEnvFor(config()).COMPOSE_PROFILES).toBeUndefined()
  })

  it("deletes the overlays this project does not use", () => {
    const removed = overlaysToRemove(config({ database: "postgresql" }))
    expect(removed).toContain("compose.mysql.yml")
    expect(removed).toContain("compose.mariadb.yml")
    expect(removed).not.toContain("compose.postgres.yml")
    // The dev overlay layers hot reload onto whatever topology was chosen, so
    // it is not a topology of its own and is always kept.
    expect(removed).not.toContain("compose.dev.yml")
  })

  it("removes every Compose file from a local project", () => {
    // Shipping one would suggest `docker compose up` is supported when the
    // .env was written for localhost.
    const removed = overlaysToRemove(
      config({ deploymentMode: "local", storage: "s3", externalStorage: EXTERNAL }),
    )
    expect(removed).toContain("compose.yml")
  })
})

describe("the Docker package-manager block", () => {
  it.each([
    ["npm", "package-lock.json"],
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["bun", "bun.lock"],
  ])("knows %s's lockfile is %s", (manager, lockfile) => {
    expect(LOCKFILES[manager]).toBe(lockfile)
  })

  it("uses a frozen install for every manager", () => {
    // A build that re-resolves is a build that is not reproducible, and the
    // symptom appears weeks later.
    expect(installCommandFor("npm")).toBe("npm ci --ignore-scripts")
    expect(installCommandFor("pnpm")).toContain("--frozen-lockfile")
    expect(installCommandFor("bun")).toContain("--frozen-lockfile")
    expect(installCommandFor("yarn", { yarnMajor: 1 })).toContain("--frozen-lockfile")
    expect(installCommandFor("yarn", { yarnMajor: 4 })).toContain("--immutable")
  })

  it("enables corepack for pnpm and yarn, which Node 22 leaves off", () => {
    expect(needsCorepack("pnpm")).toBe(true)
    expect(needsCorepack("yarn")).toBe(true)
    expect(needsCorepack("npm")).toBe(false)
    expect(renderPackageManagerBlock("pnpm")).toContain("corepack enable")
  })

  it("brings bun in as a binary and leaves the runtime on Node", () => {
    const block = renderPackageManagerBlock("bun")
    expect(block).toContain("COPY --from=oven/bun:1")
    expect(block).toContain("bun install --frozen-lockfile")
    // Choosing bun to install must not change what runs the server.
    expect(block).not.toMatch(/bun (run )?server/)
    expect(block).not.toContain("CMD")
  })

  it("fails with a sentence when the lockfile is missing", () => {
    // `--skip-install` leaves none, and buildkit's "not found" tells an
    // operator nothing about which command they skipped.
    const block = renderPackageManagerBlock("npm")
    expect(block).toContain("No package-lock.json in the build context.")
    expect(block).toContain("npm install")
  })

  it("copies the local flowcms manifest, which the lockfile references", () => {
    expect(renderPackageManagerBlock("npm")).toContain("COPY packages/flowcms/package.json")
  })

  it("replaces only the marked region of the Dockerfile", () => {
    const source = [
      "FROM node:22",
      "# flowcms:render:package-manager",
      "COPY package.json package-lock.json ./",
      "RUN npm ci",
      "# flowcms:render:end",
      "COPY . .",
    ].join("\n")

    const rendered = renderDockerfile(source, "pnpm")
    expect(rendered).toContain("FROM node:22")
    expect(rendered).toContain("COPY . .")
    expect(rendered).toContain("pnpm install --frozen-lockfile")
    expect(rendered).not.toContain("npm ci")
    expect(rendered).not.toContain("flowcms:render:")
  })

  it("refuses a Dockerfile with no marked region", () => {
    expect(() => renderDockerfile("FROM node:22", "npm")).toThrow(/no flowcms:render/)
  })

  it("interpolates nothing operator-controlled", () => {
    // The manager is an enum member; the rendered text comes from a table. A
    // shell line built from free input would be a command-injection surface in
    // an image build.
    for (const manager of ["npm", "pnpm", "yarn", "bun"]) {
      expect(renderPackageManagerBlock(manager)).not.toMatch(/\$\{/)
    }
  })
})

describe("the repository's own Dockerfile", () => {
  it("carries the render markers the installer needs", () => {
    const source = readFileSync(join(process.cwd(), "Dockerfile"), "utf8")
    expect(source).toContain("# flowcms:render:package-manager")
    expect(source).toContain("# flowcms:render:end")
  })
})

describe("the project marker", () => {
  it("records the non-secret choices", () => {
    const marker = buildProjectMarker(config({ database: "postgresql", adminPath: "/control" }), {
      templateVersion: "0.1.0",
      cliVersion: "0.1.0",
    })
    expect(marker).toMatchObject({
      deploymentMode: "docker",
      packageManager: "npm",
      databaseDialect: "postgresql",
      storageMode: "garage",
      redisMode: "none",
      adminPath: "/control",
    })
  })

  it("contains no secret", () => {
    // This file IS committed, unlike .env.
    const built = config({ database: "postgresql" })
    const serialized = JSON.stringify(
      buildProjectMarker(built, { templateVersion: "0.1.0", cliVersion: "0.1.0" }),
    )
    for (const secret of Object.values(built.secrets).filter(Boolean)) {
      expect(serialized).not.toContain(secret as string)
    }
  })

  it("contains no URL, because a URL carries credentials", () => {
    const built = config({ database: "postgresql" })
    const serialized = JSON.stringify(
      buildProjectMarker(built, { templateVersion: "0.1.0", cliVersion: "0.1.0" }),
    )
    expect(serialized).not.toMatch(/:\/\//)
  })
})

describe("the generated README", () => {
  it("uses the selected package manager's commands", () => {
    const readme = buildReadme(config({ packageManager: "pnpm" }))
    expect(readme).toContain("pnpm install")
    expect(readme).toContain("pnpm run build")
    expect(readme).not.toMatch(/^npm install$/m)
  })

  it("describes the chosen topology", () => {
    const readme = buildReadme(config({ database: "mariadb", adminPath: "/control" }))
    expect(readme).toContain("MariaDB")
    expect(readme).toContain("/control")
  })

  it("points at /setup and names the token without printing it", () => {
    const built = config()
    const readme = buildReadme(built)
    expect(readme).toContain("/setup")
    expect(readme).toContain("FLOWCMS_SETUP_TOKEN")
    expect(readme).not.toContain(built.secrets.setupToken)
    // Phase 7.1 forbids a token in a URL.
    expect(readme).not.toMatch(/setup\?token=/)
  })

  it("shows the configured admin path, never the internal route", () => {
    const readme = buildReadme(config({ adminPath: "/control" }))
    expect(readme).toContain("/control/login")
    expect(readme).not.toContain("/admin-panel")
  })

  it("says the install is required before a Docker build", () => {
    expect(buildReadme(config())).toMatch(/creates the lockfile/)
  })

  it("contains no secret at all", () => {
    const built = config({ database: "postgresql" })
    const readme = buildReadme(built)
    for (const secret of Object.values(built.secrets).filter(Boolean)) {
      expect(readme).not.toContain(secret as string)
    }
  })
})

const EXTERNAL = {
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  bucket: "flowcms",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "s3cr3t",
}
