import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { HELP, UsageError, parseArgs } from "../../packages/create-flowcms/src/args.mjs"
import { INSTALL_ENV, resolveConfig } from "../../packages/create-flowcms/src/config/resolve.mjs"

/**
 * THE COMMAND-LINE SURFACE of deployment configuration.
 *
 * The routing decision this pins is the one that makes the CLI usable from CI:
 * a command with every flag supplied behaves identically whether or not a
 * terminal is attached, and a command missing something either asks (a TTY) or
 * fails naming the flag (no TTY). It never guesses.
 */

const FULL = [
  "my-site",
  "--deployment", "docker",
  "--package-manager", "npm",
  "--database", "sqlite",
  "--storage", "garage",
  "--redis", "none",
  "--admin-path", "/admin",
]

/** Never interactive, and never prompted — a prompt here is a failed test. */
const nonInteractive = {
  isInteractive: () => false,
  prompt: () => {
    throw new Error("a non-interactive run must never prompt")
  },
}

describe("deployment flags", () => {
  it("parses every deployment choice", () => {
    expect(parseArgs(FULL)).toMatchObject({
      directory: "my-site",
      deploymentMode: "docker",
      packageManager: "npm",
      database: "sqlite",
      storage: "garage",
      redis: "none",
      adminPath: "/admin",
    })
  })

  it("accepts both --flag value and --flag=value", () => {
    expect(parseArgs(["s", "--database=mariadb"]).database).toBe("mariadb")
    expect(parseArgs(["s", "--database", "mariadb"]).database).toBe("mariadb")
  })

  it.each([
    ["--database", "oracle"],
    ["--storage", "local"],
    ["--redis", "memcached"],
    ["--deployment", "kubernetes"],
    ["--package-manager", "cargo"],
  ])("refuses an invented value for %s", (flag, value) => {
    expect(() => parseArgs(["s", flag, value])).toThrow(UsageError)
  })

  it("refuses a flag with no value", () => {
    expect(() => parseArgs(["s", "--database"])).toThrow(/needs a value/)
    expect(() => parseArgs(["s", "--admin-path"])).toThrow(/needs a value/)
  })

  it("leaves unsupplied choices UNSET rather than defaulted", () => {
    // The difference is what lets the resolver tell "not chosen" from "chosen
    // to be the default": one is a question to ask, the other is not.
    const parsed = parseArgs(["my-site"])
    expect(parsed.database).toBeUndefined()
    expect(parsed.deploymentMode).toBeUndefined()
    expect(parsed.storage).toBeUndefined()
  })

  it("still refuses unknown flags", () => {
    expect(() => parseArgs(["s", "--postgres"])).toThrow(/Unknown option/)
  })

  it("exposes NO flag that would carry a secret", () => {
    // A secret in a flag is a secret in shell history, `ps` output and CI logs.
    for (const forbidden of [
      "--auth-secret",
      "--captcha-secret",
      "--setup-token",
      "--db-password",
      "--database-password",
      "--s3-secret-key",
      "--s3-secret-access-key",
      "--redis-password",
    ]) {
      expect(() => parseArgs(["s", forbidden, "x"]), forbidden).toThrow(/Unknown option/)
      expect(HELP, forbidden).not.toContain(forbidden)
    }
  })
})

describe("help", () => {
  it("documents every deployment flag", () => {
    for (const flag of [
      "--deployment",
      "--database",
      "--storage",
      "--redis",
      "--admin-path",
      "--package-manager",
      "--skip-install",
    ]) {
      expect(HELP, flag).toContain(flag)
    }
  })

  it("says where secrets come from, since no flag carries one", () => {
    expect(HELP).toMatch(/Secrets are never flags/)
    expect(HELP).toMatch(/FLOWCMS_INSTALL_/)
  })

  it("says scaffolding is not the same as first-run setup", () => {
    expect(HELP).toMatch(/\/setup/)
    expect(HELP).toMatch(/FLOWCMS_SETUP_TOKEN/)
  })

  it("is not a wall of environment variables", () => {
    expect(HELP.split("\n").length).toBeLessThan(60)
  })
})

describe("non-interactive resolution", () => {
  it("completes when every choice was supplied", async () => {
    const { config, session } = await resolveConfig(
      { ...parseArgs(FULL), projectName: "my-site" },
      nonInteractive,
    )
    expect(session).toBeNull()
    expect(config.database).toBe("sqlite")
    expect(config.adminPath).toBe("/admin")
  })

  it("fails naming the flag when something is missing", async () => {
    await expect(
      resolveConfig({ ...parseArgs(["my-site"]), projectName: "my-site" }, nonInteractive),
    ).rejects.toThrow(/--deployment is required in a non-interactive run/)
  })

  it("never silently picks a database", async () => {
    // An installer that quietly chose SQLite because it could not ask would be
    // choosing somebody's database for them.
    await expect(
      resolveConfig(
        { ...parseArgs(["my-site", "--deployment", "docker", "--package-manager", "npm"]), projectName: "s" },
        nonInteractive,
      ),
    ).rejects.toThrow(/--database is required/)
  })

  it("reads external S3 credentials from the installer namespace", async () => {
    const env = {
      [INSTALL_ENV.s3Endpoint]: "https://s3.example.com",
      [INSTALL_ENV.s3Region]: "us-east-1",
      [INSTALL_ENV.s3Bucket]: "bucket",
      [INSTALL_ENV.s3AccessKeyId]: "key",
      [INSTALL_ENV.s3SecretAccessKey]: "secret",
    }

    const { config } = await resolveConfig(
      {
        ...parseArgs([
          "my-site", "--deployment", "local", "--package-manager", "npm",
          "--database", "sqlite", "--storage", "s3", "--redis", "none",
        ]),
        projectName: "my-site",
      },
      { ...nonInteractive, env },
    )

    expect(config.externalStorage?.bucket).toBe("bucket")
  })

  it("uses a namespace distinct from the application's own variables", async () => {
    // If the installer read S3_SECRET_ACCESS_KEY, a machine with FlowCMS's
    // runtime environment loaded would silently configure a new project with
    // the old installation's credentials.
    for (const name of Object.values(INSTALL_ENV)) {
      expect(name.startsWith("FLOWCMS_INSTALL_"), name).toBe(true)
    }
    expect(Object.values(INSTALL_ENV)).not.toContain("S3_SECRET_ACCESS_KEY")
    expect(Object.values(INSTALL_ENV)).not.toContain("DATABASE_URL")
  })

  it("refuses partial S3 credentials rather than half-configuring storage", async () => {
    const env = { [INSTALL_ENV.s3Endpoint]: "https://s3.example.com" }
    await expect(
      resolveConfig(
        {
          ...parseArgs([
            "my-site", "--deployment", "local", "--package-manager", "npm",
            "--database", "sqlite", "--storage", "s3", "--redis", "none",
          ]),
          projectName: "my-site",
        },
        { ...nonInteractive, env },
      ),
    ).rejects.toThrow(/external S3 credentials/)
  })

  it("requires a database URL for a server database outside Docker", async () => {
    // There is no Compose service for the installer to create.
    await expect(
      resolveConfig(
        {
          ...parseArgs([
            "my-site", "--deployment", "local", "--package-manager", "npm",
            "--database", "postgresql", "--storage", "s3", "--redis", "none",
          ]),
          projectName: "my-site",
        },
        { ...nonInteractive, env: {} },
      ),
    ).rejects.toThrow(/a database URL/)
  })
})

describe("interactive resolution", () => {
  it("asks only for what the flags did not answer", async () => {
    let asked: string[] = []
    const prompt = async (partial: Record<string, unknown>) => {
      asked = Object.entries(partial)
        .filter(([, value]) => value === undefined)
        .map(([key]) => key)
      return {
        answers: { database: "postgresql", storage: "garage", redis: "none" },
        confirm: async () => true,
        close: () => {},
      }
    }

    const { config, session } = await resolveConfig(
      {
        ...parseArgs(["my-site", "--deployment", "docker", "--package-manager", "pnpm"]),
        projectName: "my-site",
      },
      { isInteractive: () => true, prompt },
    )

    expect(session).not.toBeNull()
    expect(config.packageManager).toBe("pnpm")
    expect(config.database).toBe("postgresql")
    expect(asked).not.toContain("packageManager")
  })

  it("does not prompt at all when every answer was supplied", async () => {
    const { session } = await resolveConfig(
      { ...parseArgs(FULL), projectName: "my-site" },
      {
        isInteractive: () => true,
        prompt: () => {
          throw new Error("nothing was missing; nothing should have been asked")
        },
      },
    )
    expect(session).toBeNull()
  })
})

describe("the CLI stays a standalone, dependency-free package", () => {
  const ROOT = join(process.cwd(), "packages", "create-flowcms")

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry)
      return statSync(full).isDirectory() ? walk(full) : full.endsWith(".mjs") ? [full] : []
    })
  }

  const files = [...walk(join(ROOT, "src")), join(ROOT, "bin", "create-flowcms.mjs")]

  const code = (source: string) =>
    source
      .replace(new RegExp("/\\*[\\s\\S]*?\\*/", "g"), "")
      .replace(new RegExp("(^|[^:])//.*$", "gm"), "$1")

  const IMPORT = /^\s*import\s[^"']*from\s+["']([^"']+)["']/gm

  it("found the sources", () => {
    expect(files.length).toBeGreaterThanOrEqual(14)
  })

  it("imports only Node builtins and its own files", () => {
    // Still zero dependencies after adding an interactive installer: seven
    // questions do not justify a supply chain.
    for (const file of files) {
      for (const match of code(readFileSync(file, "utf8")).matchAll(IMPORT)) {
        expect(match[1], `${file} imports ${match[1]}`).toMatch(/^node:|^\.\.?\//)
      }
    }
  })

  it("imports nothing from the application", () => {
    for (const file of files) {
      expect(code(readFileSync(file, "utf8")), file).not.toMatch(/from ["']@\//)
    }
  })

  it("declares no dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
    expect(manifest.dependencies).toBeUndefined()
    expect(manifest.devDependencies).toBeUndefined()
  })

  it("never spawns through a shell", () => {
    // A destination path containing `;` or `$(…)` must be an ordinary path.
    for (const file of files) {
      const source = code(readFileSync(file, "utf8"))
      expect(source, file).not.toMatch(/shell:\s*true/)
      expect(source, file).not.toMatch(/\bexec\(/)
      expect(source, file).not.toMatch(/execSync\(/)
    }
  })
})
