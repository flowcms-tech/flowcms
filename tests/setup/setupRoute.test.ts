// MUST be first: it sets DATABASE_URL before `@/db/client` reads it.
import { DB_DIALECT, DB_URL } from "./setupEnv"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { db } from "@/db/client"
// Tables from the RUNTIME facade, not from @/db/schema. This suite runs
// against all four engines, and a query built from the canonical SQLite column
// objects carries SQLite encoders/decoders to whichever engine answered — the
// Phase 5.2 defect. It bit this very file: postgres.js returns bigint as a
// string, SQLite's timestamp mapper turned that into an Invalid Date, and an
// assertion comparing NaN to NaN passed vacuously.
// SETTINGS_SINGLETON_ID stays canonical: it is a dialect-free constant, and the
// facade deliberately does not re-export it.
import { settings, users, activityLog } from "@/db/tables"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { GET, POST } from "@/app/api/setup/route"
import { invalidateSettingsCache } from "@/Framework/Settings/SettingsService"
import { __resetInMemoryRateLimitStore } from "@/Framework/RateLimit/RateLimiter"
import { SETUP_MAX_ATTEMPTS_PER_IP } from "@/Framework/Setup/setupProtection"

/**
 * The transport shell, driven as a real request.
 *
 * `POST /api/setup` is the only unauthenticated mutation in FlowCMS that
 * creates an account, so the interesting assertions are not "does it work" —
 * `setupBoundary.test.ts` covers that — but what it refuses, in what ORDER, and
 * what it says while refusing.
 */

/** 43 characters of base64url, the shape .env.example tells operators to make. */
const TOKEN = "K7mQx2vB9pLnR4tZ8sWdF6hJ3yC5aE1gN0uT7iO2kM4"
const ORIGIN = "https://cms.example.test"

const VALID_BODY = {
  siteName: "Acme Docs",
  tagline: "Everything we know",
  ownerName: "Ada Lovelace",
  ownerEmail: "owner@example.com",
  ownerPassword: "correct-horse-battery-staple",
  confirmPassword: "correct-horse-battery-staple",
  setupToken: TOKEN,
}

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${ORIGIN}/api/setup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "cms.example.test",
      origin: ORIGIN,
      "x-forwarded-for": "203.0.113.10",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

beforeAll(async () => {
  if (DB_DIALECT === "sqlite") {
    const { createClient } = await import("@libsql/client")
    const { drizzle } = await import("drizzle-orm/libsql")
    const { migrate } = await import("drizzle-orm/libsql/migrator")
    const client = createClient({ url: DB_URL })
    try {
      await migrate(drizzle(client), { migrationsFolder: "src/db/migrations/sqlite" })
    } finally {
      client.close()
    }
  }
})

beforeEach(async () => {
  process.env.FLOWCMS_SETUP_TOKEN = TOKEN
  // No S3 is configured in this suite, so the storage prerequisite reports
  // `not_configured` and completion never reaches the database. That is
  // deliberate: this file is about what the transport shell REFUSES and in what
  // order, and every case here asserts on a refusal that happens before the
  // prerequisite check. The happy path lives in `setupBoundary.test.ts`, which
  // drives the domain directly, and end-to-end in the Docker proof against a
  // live Garage.
  __resetInMemoryRateLimitStore()
  await db.delete(activityLog).where(eq(activityLog.entityType, "installation"))
  await db.delete(users)
  await db.delete(settings).where(eq(settings.id, SETTINGS_SINGLETON_ID))
  await invalidateSettingsCache()
})

afterEach(() => {
  delete process.env.FLOWCMS_SETUP_TOKEN
})

async function json(response: Response) {
  return (await response.json()) as { message?: string | string[]; data?: Record<string, unknown> }
}

/** Marks the installation initialized without going through the route. */
async function closeSetup() {
  await db.insert(settings).values({
    id: SETTINGS_SINGLETON_ID,
    siteName: "Already Installed",
    setupCompletedAt: new Date(1_700_000_000_000),
    updatedAt: new Date(1_700_000_000_000),
  })
  await invalidateSettingsCache()
}

describe("once the installation is initialized, the route is gone", () => {
  it("404s the status endpoint", async () => {
    await closeSetup()
    const response = await GET()
    expect(response.status).toBe(404)
  })

  it("404s the mutation", async () => {
    await closeSetup()
    const response = await POST(post(VALID_BODY))
    expect(response.status).toBe(404)
  })

  it("404s the mutation even with a perfectly valid token", async () => {
    // §20: a valid old setup token must not reopen setup.
    await closeSetup()
    const response = await POST(post({ ...VALID_BODY, setupToken: TOKEN }))
    expect(response.status).toBe(404)
    expect(await db.select().from(users)).toHaveLength(0)
  })

  it("discloses nothing about the installation", async () => {
    // §21: no owner email, no completion timestamp, no admin path, no counts.
    await closeSetup()
    const body = await json(await GET())
    const serialized = JSON.stringify(body)
    for (const leak of ["Already Installed", "owner@", "setupCompletedAt", "admin", "1700000000000"]) {
      expect(serialized.toLowerCase()).not.toContain(leak.toLowerCase())
    }
  })

  it("is checked BEFORE the token, so a completed install is not a token oracle", async () => {
    await closeSetup()
    const wrongToken = await POST(post({ ...VALID_BODY, setupToken: "totally-wrong-but-long-enough-value" }))
    const rightToken = await POST(post(VALID_BODY))
    expect(wrongToken.status).toBe(404)
    expect(rightToken.status).toBe(404)
  })
})

describe("the setup token", () => {
  it("refuses a wrong token generically, without saying it was the token", async () => {
    const response = await POST(post({ ...VALID_BODY, setupToken: "wrong-token-of-sufficient-length" }))
    expect(response.status).toBe(401)
    const body = await json(response)
    expect(String(body.message)).toMatch(/Setup authorization failed/i)
    expect(await db.select().from(users)).toHaveLength(0)
  })

  it("locks web setup when no token is configured, and says why", async () => {
    delete process.env.FLOWCMS_SETUP_TOKEN
    const response = await POST(post(VALID_BODY))
    expect(response.status).toBe(503)
    const body = await json(response)
    expect(String(body.message)).toMatch(/FLOWCMS_SETUP_TOKEN/)
    // Points at the alternative for an operator with server access, rather than
    // leaving them stuck.
    expect(String(body.message)).toMatch(/bootstrap-owner/)
  })

  it("refuses to run on an obviously unsafe configured token", async () => {
    process.env.FLOWCMS_SETUP_TOKEN = "changeme"
    const response = await POST(post({ ...VALID_BODY, setupToken: "changeme" }))
    expect(response.status).toBe(503)
    expect(await db.select().from(users)).toHaveLength(0)
  })

  it("never echoes a submitted token, however hostile", async () => {
    // §41. The token field is attacker-controlled on a public endpoint; if it
    // came back it would be reflected XSS with the operator's own secret.
    const hostile = '<script>alert(1)</script>"><img src=x onerror=alert(2)>'
    const response = await POST(post({ ...VALID_BODY, setupToken: hostile }))
    const raw = await response.text()
    expect(raw).not.toContain(hostile)
    expect(raw).not.toContain("<script>")
    expect(raw).not.toContain("onerror")
  })

  it("never echoes the CONFIGURED token in any response", async () => {
    const wrong = await POST(post({ ...VALID_BODY, setupToken: "definitely-the-wrong-token-value" }))
    expect(await wrong.text()).not.toContain(TOKEN)

    const status = await GET()
    expect(await status.text()).not.toContain(TOKEN)
  })

  it("does not put the token in the status endpoint's payload", async () => {
    const body = await json(await GET())
    expect(body.data).toHaveProperty("setupTokenConfigured")
    expect(JSON.stringify(body)).not.toContain(TOKEN)
  })
})

describe("same-origin", () => {
  it("refuses a cross-origin POST even with the correct token", async () => {
    // §32. The token proves knowledge, not intent — and the operator holding it
    // is exactly who a hostile page would ride.
    const response = await POST(post(VALID_BODY, { origin: "https://evil.example" }))
    expect(response.status).toBe(403)
    expect(await db.select().from(users)).toHaveLength(0)
  })

  it("refuses when neither Origin nor Sec-Fetch-Site is present", async () => {
    // Fails closed. A browser always sends one of them for a form post.
    const request = new NextRequest(`${ORIGIN}/api/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "cms.example.test" },
      body: JSON.stringify(VALID_BODY),
    })
    const response = await POST(request)
    expect(response.status).toBe(403)
  })

  it("accepts Sec-Fetch-Site: same-origin without an Origin header", async () => {
    const request = new NextRequest(`${ORIGIN}/api/setup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "cms.example.test",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify(VALID_BODY),
    })
    const response = await POST(request)
    expect(response.status).not.toBe(403)
  })

  it("honours x-forwarded-host, because every real deployment has a proxy", async () => {
    const request = new NextRequest("http://upstream:3000/api/setup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "upstream:3000",
        "x-forwarded-host": "cms.example.test",
        origin: ORIGIN,
      },
      body: JSON.stringify(VALID_BODY),
    })
    const response = await POST(request)
    expect(response.status).not.toBe(403)
  })
})

describe("rate limiting", () => {
  it("throttles repeated failures from one client and reports Retry-After", async () => {
    const bad = { ...VALID_BODY, setupToken: "wrong-token-of-sufficient-length" }

    for (let i = 0; i < SETUP_MAX_ATTEMPTS_PER_IP; i += 1) {
      const response = await POST(post(bad))
      expect(response.status, `attempt ${i + 1}`).toBe(401)
    }

    const throttled = await POST(post(bad))
    expect(throttled.status).toBe(429)
    expect(throttled.headers.get("Retry-After")).toBeTruthy()
  })

  it("throttles the CORRECT token too, once the budget is gone", async () => {
    // The limiter is consumed before the comparison, on purpose: an attacker
    // must not be able to spend an unlimited number of bcrypt hashes, and a
    // limiter that exempted valid attempts would be a way to test validity.
    const bad = { ...VALID_BODY, setupToken: "wrong-token-of-sufficient-length" }
    for (let i = 0; i < SETUP_MAX_ATTEMPTS_PER_IP; i += 1) await POST(post(bad))

    const response = await POST(post(VALID_BODY))
    expect(response.status).toBe(429)
    expect(await db.select().from(users)).toHaveLength(0)
  })

  it("budgets per client, so one attacker cannot lock out the operator", async () => {
    const bad = { ...VALID_BODY, setupToken: "wrong-token-of-sufficient-length" }
    for (let i = 0; i < SETUP_MAX_ATTEMPTS_PER_IP + 5; i += 1) {
      await POST(post(bad, { "x-forwarded-for": "198.51.100.7" }))
    }

    // A different client still has its full budget. There is deliberately no
    // global window: it would let anyone on the internet deny the operator the
    // one action that cannot be retried from somewhere else.
    const operator = await POST(post(bad, { "x-forwarded-for": "203.0.113.99" }))
    expect(operator.status).toBe(401)
  })
})

describe("transport validation", () => {
  it("rejects a malformed body without a stack trace", async () => {
    const response = await POST(post("{not json"))
    expect(response.status).toBe(400)
    const raw = await response.text()
    expect(raw).not.toMatch(/at .*\.ts:\d+/)
    expect(raw).not.toMatch(/SyntaxError/)
  })

  it("returns 422 with a message array, matching the app's convention", async () => {
    const response = await POST(post({ ...VALID_BODY, ownerEmail: "not-an-email" }))
    expect(response.status).toBe(422)
    const body = await json(response)
    expect(Array.isArray(body.message)).toBe(true)
    expect(String(body.message)).toMatch(/email/i)
  })

  it("rejects unexpected keys rather than ignoring them", async () => {
    // `.strict()`. An extra key on an unauthenticated endpoint is either a
    // client bug or someone probing for a way into the settings row.
    const response = await POST(post({ ...VALID_BODY, role: "owner", isActive: true }))
    expect(response.status).toBe(422)
  })

  it("rejects mismatched password confirmation", async () => {
    const response = await POST(post({ ...VALID_BODY, confirmPassword: "something-else-entirely" }))
    expect(response.status).toBe(422)
    expect(String((await json(response)).message)).toMatch(/match/i)
  })

  it("never returns raw Zod internals", async () => {
    const response = await POST(post({ ...VALID_BODY, siteName: "" }))
    const raw = await response.text()
    expect(raw).not.toMatch(/"code":"too_small"/)
    expect(raw).not.toMatch(/"path":\[/)
    expect(raw).not.toContain("ZodError")
  })

  it("never echoes the submitted password in a validation failure", async () => {
    const response = await POST(post({ ...VALID_BODY, ownerPassword: "hunter2", confirmPassword: "hunter2" }))
    expect(await response.text()).not.toContain("hunter2")
  })
})

describe("the public status endpoint", () => {
  it("reports states only — no endpoint, bucket, credential or URL", async () => {
    const body = await json(await GET())
    const serialized = JSON.stringify(body)
    for (const leak of [
      "s3",
      "bucket",
      "postgres",
      "mysql",
      "redis",
      "secret",
      "password",
      "://",
      "DATABASE_URL",
    ]) {
      expect(serialized.toLowerCase(), `must not contain "${leak}"`).not.toContain(leak.toLowerCase())
    }
  })

  it("does not name the configured admin path before an owner exists", async () => {
    // The setup page must not advertise where the panel lives to an anonymous
    // caller on an unowned installation.
    const body = await json(await GET())
    expect(JSON.stringify(body)).not.toMatch(/admin/i)
  })

  it("answers with a bounded, fixed set of fields", async () => {
    const body = await json(await GET())
    // `captcha` joined in Phase 7.1.1 and `auth` in 7.1.2. Every entry is a
    // fixed state or a boolean about CONFIGURATION — nothing derived from any
    // secret, and the two secret states stay separate so an operator learns
    // which variable to set.
    expect(Object.keys(body.data ?? {}).sort()).toEqual([
      "auth",
      "canComplete",
      "captcha",
      "database",
      "setupRequired",
      "setupTokenConfigured",
      "setupTokenProblem",
      "storage",
    ])
  })
})
