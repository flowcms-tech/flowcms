import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Structural guarantees about first-run setup that no runtime test can make.
 *
 * These read the source tree. A checklist rots; a walk of the repository does
 * not — the same reasoning behind `routeCoverage.test.ts` and
 * `runtimeSchemaBinding.test.ts`.
 */

const SETUP_DIR = join(process.cwd(), "src/Framework/Setup")
const SETUP_MODULE_DIR = join(process.cwd(), "src/Modules/Setup")

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(full) ? [full] : []
  })
}

const SETUP_SOURCES = [
  ...walk(SETUP_DIR),
  ...walk(SETUP_MODULE_DIR),
  join(process.cwd(), "src/app/api/setup/route.ts"),
  join(process.cwd(), "src/app/setup/page.tsx"),
]

const rel = (file: string) => relative(process.cwd(), file).split(sep).join("/")

/** Source with comments removed, so prose cannot trip or satisfy a guard. */
function code(source: string): string {
  const BLOCK = new RegExp("/\\*[\\s\\S]*?\\*/", "g")
  const LINE = new RegExp("(^|[^:])//.*$", "gm")
  return source.replace(BLOCK, "").replace(LINE, "$1")
}

describe("the walk found the setup surface", () => {
  it("collected every source file", () => {
    // A walk that silently matched nothing would let every assertion below pass
    // against an empty set.
    expect(SETUP_SOURCES.length).toBeGreaterThanOrEqual(8)
    for (const file of SETUP_SOURCES) expect(statSync(file).isFile(), rel(file)).toBe(true)
  })
})

describe("the setup token never escapes the server", () => {
  it("is never logged", () => {
    // §40. A token in a log line is a token in a log aggregator, a support
    // ticket, and a screenshot.
    for (const file of SETUP_SOURCES) {
      const source = code(readFileSync(file, "utf8"))
      const logs = source.match(/console\.(log|error|warn|info|debug)\([^\n]*/g) ?? []
      for (const line of logs) {
        expect(line, `${rel(file)}: ${line}`).not.toMatch(/token/i)
      }
    }
  })

  it("is never read from a URL or query string", () => {
    // §6. URLs reach browser history, proxy access logs and Referer headers.
    for (const file of SETUP_SOURCES) {
      const source = code(readFileSync(file, "utf8"))
      expect(source, rel(file)).not.toMatch(/searchParams[^\n]*[Tt]oken/)
      expect(source, rel(file)).not.toMatch(/[Tt]oken[^\n]*searchParams/)
    }
  })

  it("is never persisted", () => {
    // §6. The environment is the authority for exactly as long as setup is
    // open; a stored hash would be a long-lived artefact of a short-lived
    // secret.
    for (const file of SETUP_SOURCES) {
      const source = code(readFileSync(file, "utf8"))
      expect(source, rel(file)).not.toMatch(/insert\([^)]*\)[^\n]*[Tt]oken/)
      expect(source, rel(file)).not.toMatch(/setupToken:\s*(?!"")/m.source ? /db\.(insert|update)/ : /$^/)
    }
    // Positive statement of the same fact: the schema has no column for it.
    const schema = readFileSync("src/db/schema/settings.ts", "utf8")
    expect(schema.toLowerCase()).not.toContain("setuptoken")
  })

  it("is never stored in the browser", () => {
    // §39. A deployment secret in localStorage outlives the tab, the session
    // and the reason it was needed.
    for (const file of SETUP_SOURCES) {
      const source = code(readFileSync(file, "utf8"))
      expect(source, rel(file)).not.toMatch(/localStorage|sessionStorage/)
    }
  })

  it("is never pre-filled into the form", () => {
    // §39. The server knows the token; putting it in the HTML would hand it to
    // an extension, a screenshot, or a caching proxy.
    const setupModule = readFileSync(join(SETUP_MODULE_DIR, "SetupModule.tsx"), "utf8")
    expect(code(setupModule)).toMatch(/setupToken:\s*""/)

    const page = code(readFileSync("src/app/setup/page.tsx", "utf8"))
    // The page passes whether a token is CONFIGURED and why it is unusable —
    // never the value.
    expect(page).not.toMatch(/readConfiguredSetupToken\(\)\s*\}/)
    expect(page).toMatch(/tokenConfigured=/)
  })

  it("is submitted as a password-style input", () => {
    const setupModule = code(readFileSync(join(SETUP_MODULE_DIR, "SetupModule.tsx"), "utf8"))

    // Bounded by the ELEMENT, not by a character count.
    //
    // This used to read the first 300 characters after the name attribute, and
    // it broke the moment the field grew a hint and an explanatory comment.
    // `code()` removes comment TEXT but leaves the blank indented lines behind,
    // so a comment costs the budget without putting anything in it — the
    // assertion failed on a field that had `autoComplete="off"` all along,
    // sitting just past the cutoff.
    //
    // A bigger number would only move the cliff. Slicing to the element's own
    // closing `/>` has no cliff: it reads exactly the attributes of exactly this
    // field however long they get.
    const start = setupModule.indexOf('name="setupToken"')
    expect(start, "the setup token field was not found").toBeGreaterThan(-1)
    const end = setupModule.indexOf("/>", start)
    expect(end, "the setup token field has no closing tag").toBeGreaterThan(-1)
    const field = setupModule.slice(start, end)

    expect(field).toMatch(/type="password"/)
    // `off`, not `new-password`: a deployment secret shared by everyone who
    // administers the server does not belong in one person's password manager.
    expect(field).toMatch(/autoComplete="off"/)
  })
})

describe("the owner password never escapes either", () => {
  it("is never logged", () => {
    for (const file of SETUP_SOURCES) {
      const source = code(readFileSync(file, "utf8"))
      const logs = source.match(/console\.(log|error|warn|info|debug)\([^\n]*/g) ?? []
      for (const line of logs) {
        expect(line, `${rel(file)}: ${line}`).not.toMatch(/[Pp]assword/)
      }
    }
  })

  it("is never returned by the route", () => {
    const route = code(readFileSync("src/app/api/setup/route.ts", "utf8"))
    // Every NextResponse.json body in the file, checked for the submitted
    // VALUES. Key names are not the test: the status payload legitimately
    // reports `setupTokenConfigured`, which is a boolean about deployment
    // configuration and not the secret itself.
    const responses = route.match(/NextResponse\.json\([\s\S]*?\)\n/g) ?? []
    expect(responses.length).toBeGreaterThan(5)
    for (const body of responses) {
      expect(body).not.toMatch(/parsed\.data\.setupToken/)
      expect(body).not.toMatch(/parsed\.data\.ownerPassword/)
      expect(body).not.toMatch(/\bconfigured\b/)
      expect(body).not.toMatch(/ownerPassword/)
    }
  })

  it("is never written to the activity log", () => {
    const route = code(readFileSync("src/app/api/setup/route.ts", "utf8"))
    const activity = route.slice(route.indexOf("recordActivity("))
    expect(activity).toMatch(/action:/)
    expect(activity).not.toMatch(/[Pp]assword|[Tt]oken|metadata:/)
  })
})

describe("deployment configuration is not editable from the web", () => {
  it("the setup form writes no environment-owned value", () => {
    // §10/§14/§18. Setup initializes the CMS; it does not configure the
    // deployment. The Zod schema is the boundary, so its key list IS the
    // guarantee.
    const validations = readFileSync(join(SETUP_MODULE_DIR, "Values/Validations.ts"), "utf8")
    for (const forbidden of [
      "DATABASE_URL",
      "DATABASE_DIALECT",
      "s3Endpoint",
      "s3Bucket",
      "s3AccessKeyId",
      "s3SecretAccessKey",
      "adminPath",
      "FLOWCMS_ADMIN_PATH",
      "REDIS_URL",
      "AUTH_SECRET",
      "baseUrl",
    ]) {
      expect(validations, `setup must not accept ${forbidden}`).not.toContain(forbidden)
    }
  })

  it("the completion transaction writes only site identity, the marker and the owner", () => {
    const complete = code(readFileSync(join(SETUP_DIR, "completeSetup.ts"), "utf8"))
    // Settings columns touched by the claim.
    const written = complete.match(/\.set\(\{[^}]*\}/g)?.join(" ") ?? ""
    expect(written).toMatch(/siteName/)
    expect(written).toMatch(/setupCompletedAt/)
    for (const forbidden of ["activeTheme", "s3", "gsc", "bing", "indexNow", "business"]) {
      expect(written.toLowerCase(), `must not write ${forbidden}`).not.toContain(forbidden.toLowerCase())
    }
  })

  it("does not persist an alternative admin path", () => {
    for (const file of SETUP_SOURCES) {
      const source = code(readFileSync(file, "utf8"))
      expect(source, rel(file)).not.toMatch(/FLOWCMS_ADMIN_PATH/)
    }
  })
})

describe("the admin path stays runtime-configurable", () => {
  it("nothing in setup hardcodes /admin or /admin-panel", () => {
    // §37/§61. The success screen links to a path the SERVER resolved.
    for (const file of SETUP_SOURCES) {
      const source = code(readFileSync(file, "utf8"))
      expect(source, rel(file)).not.toMatch(/["'`]\/admin(-panel)?(\/|["'`])/)
    }
  })

  it("resolves the login destination through the runtime helper", () => {
    const route = code(readFileSync("src/app/api/setup/route.ts", "utf8"))
    expect(route).toMatch(/adminLoginPath\(\)/)
  })
})

describe("the proxy is untouched", () => {
  it("still performs no database access", () => {
    // §23. `src/proxy.ts` runs on nearly every request, and its bundle must
    // never transitively import the DB client. First-run redirection lives in
    // the root page's server component instead.
    const proxy = code(readFileSync("src/proxy.ts", "utf8"))
    expect(proxy).not.toMatch(/@\/db|drizzle-orm/)
    expect(proxy).not.toMatch(/Setup|setup/)
  })
})

describe("only HTML navigation is redirected into setup", () => {
  it("redirects from the site root and nowhere else", () => {
    // §24. An XML client redirected to an HTML form gets a parse error instead
    // of a feed; an orchestrator redirected instead of answered marks the
    // container unhealthy.
    const root = code(readFileSync("src/app/page.tsx", "utf8"))
    expect(root).toMatch(/redirect\("\/setup"\)/)

    for (const file of [
      "src/app/robots.ts",
      "src/app/sitemap.ts",
      "src/app/api/health/route.ts",
      "src/app/api/ready/route.ts",
      "src/app/[...path]/page.tsx",
      "src/app/blog/page.tsx",
    ]) {
      const source = code(readFileSync(file, "utf8"))
      // A redirect TO the setup page specifically, not the bare substring —
      // which legitimately appears inside `@/Framework/Setup/setupState`
      // imports in the readiness route.
      expect(source, `${file} must not redirect to setup`).not.toMatch(
        new RegExp("redirect\\(\\s*[\"'`]/setup"),
      )
    }
  })

  it("keeps the infrastructure probes public and unconditional", () => {
    const health = code(readFileSync("src/app/api/health/route.ts", "utf8"))
    expect(health).not.toMatch(/getSetupStatus|notFound/)

    const ready = code(readFileSync("src/app/api/ready/route.ts", "utf8"))
    // Readiness REPORTS setup state and must never gate on it.
    expect(ready).toMatch(/getSetupStatus/)
    expect(ready).not.toMatch(/notFound|redirect/)
  })

  it("closes the setup page with a 404 rather than an 'already installed' notice", () => {
    const page = code(readFileSync("src/app/setup/page.tsx", "utf8"))
    expect(page).toMatch(/notFound\(\)/)
    expect(page).toMatch(/!==\s*"incomplete"/)
  })
})

describe("Phase 5.2 runtime schema binding", () => {
  it("setup builds its queries from @/db/tables, never the canonical schema", () => {
    // A query built from the canonical SQLite table objects sends SQLite
    // encoders to whatever engine is connected — which is how a PostgreSQL
    // boolean silently became `false` before Phase 5.2.
    // The FORBIDDING is owned by `tests/architecture/runtimeSchemaBinding.test.ts`,
    // which discovers the canonical table set from the schema itself and walks
    // all of `src/`. This states the positive half for the setup domain, and
    // pins the one import that LOOKS like a violation and is not.
    const complete = code(readFileSync(join(SETUP_DIR, "completeSetup.ts"), "utf8"))
    expect(complete).toMatch(/settings, users \} from "@\/db\/tables"/)
    // The singleton id is a plain constant with no dialect, so it correctly
    // comes from the canonical module — reading it from the facade would return
    // undefined on PostgreSQL.
    // The `s` flag needs an es2018 target this project does not use, so the
    // any-character class does the same job portably.
    expect(complete).toMatch(
      new RegExp('SETTINGS_SINGLETON_ID[\\s\\S]*from "@/db/schema/settings"'),
    )
  })
})
