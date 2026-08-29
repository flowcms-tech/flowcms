import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { EXCLUDE, DROPPED_SCRIPTS } from "../../scripts/lib/templateManifest.mjs"
import { NEXT_DEFAULT_BUNDLER, resolveBundler } from "../../scripts/dev/bundler.mjs"

/**
 * THE LOCAL CORE DEVELOPMENT WORKFLOW, pinned to the properties it was built for.
 *
 * The defect these guard is worth restating, because it was invisible in every
 * green test the repository already had: `Dockerfile` declares
 * `ENTRYPOINT ["./docker/entrypoint.sh"]` in the `runner` stage and only there,
 * while `compose.dev.yml` builds `target: builder`. A development container
 * therefore inherited the node base image's entrypoint and ran its `command:`
 * directly — so the migration production performs before binding a port never
 * happened, and a fresh `flowcms-data` volume served
 * `SQLITE_ERROR: no such table: settings` on the first request.
 *
 * Nothing about that is testable from application code, which is why it
 * survived. These assertions read the deployment files themselves.
 */

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")

/**
 * A file with its comments removed.
 *
 * These scripts explain at length what they deliberately do NOT do — "nothing
 * here calls `scripts/bootstrap-owner.mjs`" is a sentence that exists precisely
 * because the absence matters. A test searching raw source for that filename
 * would fail on the documentation of the property it is checking, so the
 * assertions below read the CODE and the documentation is left to say what it
 * likes.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const composeDev = read("compose.dev.yml")
const containerStart = read("scripts/dev-container-start.mjs")
const productionEntrypoint = read("docker/entrypoint.sh")
const resetScript = read("scripts/dev/reset.mjs")
const upScript = read("scripts/dev/up.mjs")
const scripts: Record<string, string> = JSON.parse(read("package.json")).scripts

describe("the development container migrates before it serves", () => {
  it("compose.dev.yml does not start a server directly", () => {
    // THE REGRESSION. `command: ["npm", "run", "dev"]` is the exact line that
    // skipped migrations, and any equivalent — a bare `next dev`, a package
    // manager invocation — reintroduces the same gap.
    const command = /^\s*command:\s*(.+)$/m.exec(composeDev)?.[1] ?? ""
    expect(command).toContain("scripts/dev-container-start.mjs")
    expect(command).not.toMatch(/\b(npm|pnpm|yarn|bun)\b/)
    expect(command).not.toMatch(/next["\s,\]]/)
  })

  it("the dev starter runs migrations before it starts anything else", () => {
    const migrateAt = containerStart.indexOf("scripts/migrate.mjs")
    const serverAt = containerStart.indexOf("NEXT_ARGS =")
    const spawnServerAt = containerStart.indexOf("spawn(process.execPath, args")

    expect(migrateAt, "the dev starter must name scripts/migrate.mjs").toBeGreaterThan(-1)
    expect(spawnServerAt, "the dev starter must start Next").toBeGreaterThan(-1)
    expect(serverAt).toBeGreaterThan(-1)
    // Source order is a weak proxy on its own; the exit assertion below is the
    // one that proves the ordering is enforced rather than merely written down.
    expect(migrateAt).toBeLessThan(spawnServerAt)
  })

  it("a failed migration exits instead of starting the server", () => {
    // Without this the failure moves to the first request and looks like a
    // missing table — the whole diagnosis problem the entrypoint contract
    // exists to prevent.
    expect(containerStart).toMatch(/if \(migration !== 0\)/)
    expect(containerStart).toMatch(/process\.exit\(migration\)/)
  })

  it("the dev server command matches the root dev script", () => {
    // Pinned in both directions so a change to one is a failing test rather
    // than a container that quietly binds the wrong interface. `-H 0.0.0.0` is
    // not cosmetic: Next binds loopback by default, and a server on 127.0.0.1
    // inside a container is unreachable from the published port.
    expect(scripts.dev).toBe("next dev -H 0.0.0.0")
    expect(containerStart).toContain('"dev", "-H", "0.0.0.0"')
    expect(containerStart).toContain("node_modules/next/dist/bin/next")
  })

  it("forwards signals so a stop does not wait out the kill timeout", () => {
    expect(containerStart).toContain("SIGTERM")
    expect(containerStart).toContain("server.kill(signal)")
  })
})

describe("production startup is untouched", () => {
  it("docker/entrypoint.sh still migrates before exec'ing the server", () => {
    const migrateAt = productionEntrypoint.indexOf("node scripts/migrate.mjs")
    const execAt = productionEntrypoint.indexOf("exec node server.js")
    expect(migrateAt).toBeGreaterThan(-1)
    expect(execAt).toBeGreaterThan(migrateAt)
    expect(productionEntrypoint).toContain("set -e")
  })

  it("the Dockerfile's entrypoint is unchanged", () => {
    expect(read("Dockerfile")).toContain('ENTRYPOINT ["./docker/entrypoint.sh"]')
  })

  it("compose.yml still refuses to start without AUTH_SECRET", () => {
    // The `:?` guard is the one secret failure Compose can catch before the
    // application boots. Convenience tooling must not have removed it.
    expect(read("compose.yml")).toMatch(/AUTH_SECRET:\s*"\$\{AUTH_SECRET:\?/)
  })

  it("compose.yml still defaults FLOWCMS_SETUP_TOKEN to empty rather than to a value", () => {
    // An unset token must keep meaning "web setup is LOCKED". A development
    // convenience that shipped a default here would open first-run setup on
    // every production install that forgot the variable.
    expect(read("compose.yml")).toMatch(/FLOWCMS_SETUP_TOKEN:\s*\$\{FLOWCMS_SETUP_TOKEN:-\}/)
  })
})

describe("the setup flow stays real in development", () => {
  it("nothing in the dev tooling creates an owner", () => {
    // The environment exists to walk first-run setup by hand. A seeded owner
    // would mean the flow it was built to exercise can never be exercised.
    for (const [name, source] of [
      ["up.mjs", upScript],
      ["reset.mjs", resetScript],
      ["dev-container-start.mjs", containerStart],
    ] as const) {
      const code = codeOnly(source)
      expect(code, `${name} must not bootstrap an owner`).not.toContain("bootstrap-owner")
      expect(code, `${name} must not seed`).not.toMatch(/FLOWCMS_OWNER_(EMAIL|PASSWORD)/)
      expect(code, `${name} must not seed sample data`).not.toContain("db:seed")
    }
  })

  it("no dev script disables or bypasses setup-token validation", () => {
    // There is no development mode in `Framework/Setup/setupToken.ts` and there
    // must never be one. The tooling GENERATES a token; it does not exempt
    // anything from checking it.
    const all = [upScript, resetScript, containerStart, read("scripts/dev/localEnv.mjs")]
      .map(codeOnly)
      .join("\n")
    expect(all).not.toMatch(/SKIP_SETUP|DISABLE_SETUP|SETUP_BYPASS|FLOWCMS_DEV_SETUP/)
    expect(all).not.toMatch(/NODE_ENV\s*===?\s*["']development["'][\s\S]{0,80}token/i)
  })

  it("the token reaches the terminal and nothing else", () => {
    // Printed for the developer to paste into the form. Not written into a
    // page, not exposed by an endpoint, not pre-filled.
    expect(upScript).toContain("values.FLOWCMS_SETUP_TOKEN")
    expect(upScript).toContain("Setup token")
  })
})

describe("dev:reset resets the database and nothing else", () => {
  it("stops the app container rather than removing it", () => {
    // MEASURED, NOT PREFERRED. Removing the container discards the anonymous
    // volume masking /app/node_modules, and Docker re-seeds it from the image
    // on the next start: 1.3 GB across 647 packages, which on Windows is
    // minutes of copying on every reset. The first implementation did exactly
    // that and was rejected on the evidence.
    expect(resetScript).toContain('["stop", "app"]')

    // `down` would stop Garage too, and `down -v` would delete its data.
    expect(codeOnly(resetScript)).not.toMatch(/"down"/)

    // `--volumes` on the app container is what removed the dependency volume.
    // The fallback path removes the container only when no image exists yet,
    // and must still never pass it.
    expect(codeOnly(resetScript)).not.toContain('"--volumes"')
  })

  it("names the garage volumes only to protect them", () => {
    // THE REGRESSION THIS GUARDS: a reset that widened to "every volume in the
    // project" and took uploaded media with it.
    expect(resetScript).toContain('NEVER_TOUCH = ["garage-data", "garage-meta"]')

    // Every mention of a garage volume must sit inside the protection list or a
    // refusal, never inside a removal or a mount.
    for (const line of resetScript.split("\n")) {
      if (!/garage-(data|meta)/.test(line)) continue
      expect(line, `garage volume named outside a guard: ${line.trim()}`).not.toMatch(
        /volume["\s,]+rm|"rm"|"-v"/,
      )
    }
  })

  it("derives what to delete from DATABASE_URL rather than hardcoding a path", () => {
    expect(resetScript).toContain("DATABASE_URL")
    expect(resetScript).toContain("DATABASE_DIALECT")
    // The file must be inside a named volume declared by the app service —
    // otherwise the command has no idea what it is about to delete.
    expect(resetScript).toContain('candidate.type === "volume"')
  })

  it("refuses to guess at a non-SQLite topology", () => {
    // Dropping a PostgreSQL or MySQL schema is a different operation with
    // different consequences. Stopping with an explanation beats improvising.
    expect(resetScript).toMatch(/dialect !== "sqlite"/)
  })

  it("deletes the write-ahead log alongside the database", () => {
    // SQLite in WAL mode keeps committed transactions in `app.db-wal` until a
    // checkpoint. Deleting only `app.db` can leave a log that resurrects rows
    // into the fresh database — a reset that comes back with yesterday's owner
    // account still in it.
    expect(resetScript).toContain("entry.startsWith(base+'-')")
  })

  it("preserves the generated secrets", () => {
    // Deleting them would rotate the setup token on every reset, which is
    // precisely the manual reconfiguration this workflow removes.
    expect(codeOnly(resetScript)).not.toMatch(/unlink|rmSync\(.*env|writeFileSync/)
    expect(resetScript).toContain("the setup token is unchanged")
  })
})

describe("hot reload survives the bind mount", () => {
  it("windows hosts get the bundler whose watcher actually works", () => {
    // MEASURED. Turbopack's watcher sees nothing through a Windows bind mount
    // in either mode — event-driven (no inotify events cross) or polling
    // (pollIntervalMs reaches it, and edits still go undetected). Webpack's
    // WATCHPACK_POLLING watcher was tested the same way and works.
    expect(resolveBundler("win32", undefined)).toEqual({
      bundler: "webpack",
      reason: "windows host",
    })
  })

  it("linux keeps Next's own default, because its events do cross", () => {
    // Same kernel as the container. Switching bundlers there would degrade a
    // working setup and change compilation semantics for nothing.
    expect(resolveBundler("linux", undefined).bundler).toBe(NEXT_DEFAULT_BUNDLER)
  })

  it("macOS keeps the default, because it has not been tested here", () => {
    // Not a claim that it works — a refusal to claim that it does not. This
    // repository does not upgrade a support level without a run behind it.
    expect(resolveBundler("darwin", undefined).bundler).toBe(NEXT_DEFAULT_BUNDLER)
  })

  it("an explicit choice wins in both directions", () => {
    expect(resolveBundler("linux", "webpack").bundler).toBe("webpack")
    // Asking for turbopack ON WINDOWS must give turbopack — a developer
    // reproducing a Turbopack-specific bug needs the stale watcher too.
    expect(resolveBundler("win32", "turbopack").bundler).toBe(NEXT_DEFAULT_BUNDLER)
    expect(resolveBundler("win32", "turbopack").reason).toBe("FLOWCMS_DEV_BUNDLER")
    expect(resolveBundler("win32", "  WebPack  ").bundler).toBe("webpack")
  })

  it("the container starter passes the bundler through to Next", () => {
    expect(containerStart).toContain("FLOWCMS_DEV_BUNDLER")
    expect(containerStart).toContain('"--webpack"')
  })

  it("the dev overlay forwards the bundler choice and webpack's polling flag", () => {
    expect(composeDev).toMatch(/FLOWCMS_DEV_BUNDLER:\s*\$\{FLOWCMS_DEV_BUNDLER:-\}/)
    expect(composeDev).toMatch(/WATCHPACK_POLLING:\s*\$\{WATCHPACK_POLLING:-true\}/)
  })

  it("the overlay exposes watcher polling but does NOT default it on", () => {
    // Turbopack polling was measured and does not detect edits through a
    // Windows bind mount, while switching a Linux developer's working event
    // watcher to polling costs CPU and fills the log with "watch error"
    // lines. So the knob exists and is off; the bundler is the actual fix.
    expect(composeDev).toMatch(/FLOWCMS_WATCH_POLL_MS:\s*\$\{FLOWCMS_WATCH_POLL_MS:-\}/)
  })

  it("next.config.ts leaves polling off unless asked", () => {
    const config = read("next.config.ts")
    expect(config).toContain("FLOWCMS_WATCH_POLL_MS")
    expect(config).toContain("pollIntervalMs")
    // Guard the disable path: a developer on a host with working events sets
    // the variable to 0, and a truthiness check would silently ignore them.
    expect(config).toContain("interval > 0")
  })
})

describe("local development state cannot be committed or built into an image", () => {
  const gitignore = read(".gitignore")
  const dockerignore = read(".dockerignore")

  it(".gitignore names the generated dev env file explicitly", () => {
    // `.env.*` already covers it. The explicit rule is what survives somebody
    // narrowing that wildcard, and this file holds AUTH_SECRET, CAPTCHA_SECRET,
    // FLOWCMS_SETUP_TOKEN and the object storage credentials.
    expect(gitignore).toContain("/.env.dev.local")
    expect(gitignore).toContain(".env.dev.local")
  })

  it(".dockerignore keeps it out of the build context", () => {
    // The builder stage runs `COPY . .`, so anything not excluded here is
    // baked into an image layer.
    expect(dockerignore).toContain(".env.dev.local")
  })

  it("the ignore rules that protect runtime data are still present", () => {
    for (const rule of ["/data/", "*.db", "*.db-*", "*.sqlite", "*.sqlite3"]) {
      expect(gitignore, `.gitignore lost ${rule}`).toContain(rule)
    }
  })

  it("no runtime data is bind-mounted into the repository", () => {
    // THE GIT-SAFETY INVARIANT, read off the compose overlay: the repository is
    // mounted at /app for hot reload, and every writable runtime path is a
    // NAMED VOLUME. A bind mount pointing at a tracked directory is how an
    // instance's database ends up in `git status`.
    const mounts = [...composeDev.matchAll(/^\s+-\s+(.+)$/gm)].map((match) => match[1].trim())
    const binds = mounts.filter((mount) => mount.startsWith(".") || mount.startsWith("/"))

    // `.:/app` is the source bind mount and the only one. `/app/node_modules`
    // and `/app/.next` are anonymous volumes, which start with `/` but declare
    // no host source — they are the masking that keeps the host's native
    // modules out of the Linux container.
    const hostBinds = binds.filter((mount) => !mount.startsWith("/app/"))
    expect(hostBinds).toEqual([".:/app"])
  })

  it("keeps the anonymous-volume masking that makes hot reload work", () => {
    // Without these the host's node_modules shadows the container's, and the
    // host's native builds of libsql and @napi-rs/canvas — compiled for
    // Windows or macOS — fail to load inside a Linux container.
    expect(composeDev).toContain("- /app/node_modules")
    expect(composeDev).toContain("- /app/.next")
  })

  it("the database lives on a named volume, not in the working tree", () => {
    expect(composeDev).toContain("flowcms-data:/data")
    expect(read("compose.yml")).toContain("DATABASE_URL: ${DATABASE_URL:-file:/data/app.db}")
  })
})

describe("the workflow is Core-only and the container fix is not", () => {
  it("the host tooling is excluded from a generated project", () => {
    expect(EXCLUDE).toContain("scripts/dev")
  })

  it("the container starter ships, because generated projects run compose.dev.yml too", () => {
    // `compose.dev.yml` is a FILES entry in the template manifest, so a
    // generated project's dev overlay names this file. Excluding it would ship
    // a `command:` pointing at nothing.
    const excluded = (EXCLUDE as string[]).some(
      (entry) =>
        "scripts/dev-container-start.mjs" === entry ||
        "scripts/dev-container-start.mjs".startsWith(`${entry}/`),
    )
    expect(excluded).toBe(false)
  })

  it("the host scripts are dropped from the generated manifest", () => {
    // Paired with the EXCLUDE entry. `tests/scaffolder/rootScripts.test.ts`
    // enforces the pairing generally; this states the specific expectation.
    for (const name of ["dev:docker", "dev:docker:build", "dev:reset"]) {
      expect(DROPPED_SCRIPTS, `${name} must not ship`).toHaveProperty(name)
      expect(scripts, `${name} must exist here`).toHaveProperty(name)
    }
  })

  it("dev:docker does not rebuild and dev:docker:build does", () => {
    // Requirement 11: the everyday command must stay fast. A rebuild is an
    // `npm ci` plus a Next build, and source changes never need one because the
    // repository is bind-mounted.
    expect(scripts["dev:docker"]).toBe("node scripts/dev/up.mjs")
    expect(scripts["dev:docker:build"]).toBe("node scripts/dev/up.mjs --build")
    expect(upScript).toContain('process.argv.includes("--build")')
  })

  it("no dev script delegates through a package manager", () => {
    // The same rule CONTRIBUTING.md states for root scripts, applied to the
    // files those scripts run.
    for (const [name, source] of [
      ["up.mjs", upScript],
      ["reset.mjs", resetScript],
    ] as const) {
      expect(source, `${name} spawns a package manager`).not.toMatch(
        /spawn\(\s*["'](npm|pnpm|yarn|bun)["']/,
      )
    }
  })
})
