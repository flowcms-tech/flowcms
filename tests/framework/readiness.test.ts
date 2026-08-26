import { describe, expect, it } from "vitest"
import { buildReadinessReport } from "@/Framework/Health/readiness"

/**
 * Readiness answers one question — can this instance serve traffic — and the
 * answer must not depend on things the operator has not configured yet.
 *
 * The storage rule is the one worth pinning down. A fresh install has no bucket
 * credentials, because the operator has just started the container and has not
 * opened Settings yet. If that counted as unready, an orchestrator would
 * restart the container exactly while the human was typing the configuration
 * that would fix it, and the restart would take Settings away mid-edit.
 */

describe("buildReadinessReport", () => {
  it("is ready when the database is reachable and storage is configured", () => {
    const report = buildReadinessReport({ database: "ok", storage: "connected" })
    expect(report.status).toBe("ready")
    expect(report.httpStatus).toBe(200)
  })

  it("stays ready when storage is not configured", () => {
    const report = buildReadinessReport({ database: "ok", storage: "not_configured" })
    expect(report.status).toBe("ready")
    expect(report.httpStatus).toBe(200)
    expect(report.storage).toBe("not_configured")
  })

  it("stays ready when storage is configured but unreachable", () => {
    // Uploads break; the CMS does not. Settings has to stay reachable so the
    // operator can correct the endpoint that is failing.
    const report = buildReadinessReport({ database: "ok", storage: "connection_failed" })
    expect(report.status).toBe("ready")
    expect(report.httpStatus).toBe(200)
  })

  it("is NOT ready when the database is unreachable", () => {
    const report = buildReadinessReport({ database: "unavailable", storage: "connected" })
    expect(report.status).toBe("not_ready")
    expect(report.httpStatus).toBe(503)
  })

  it("is NOT ready when migrations have not been applied", () => {
    // The exact state a container reaches if the entrypoint's migration step is
    // skipped: the file opens, but the schema the code expects is absent.
    const report = buildReadinessReport({ database: "migrations_pending", storage: "connected" })
    expect(report.status).toBe("not_ready")
    expect(report.httpStatus).toBe(503)
  })

  it("reports every component so an operator sees the whole picture", () => {
    const report = buildReadinessReport({ database: "ok", storage: "not_configured" })
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining(["status", "database", "storage"]),
    )
  })
})

describe("readiness payload leaks nothing", () => {
  /**
   * These endpoints are unauthenticated infrastructure. Everything they return
   * is world-readable, so the vocabulary is states and nothing else — no
   * endpoint hostnames, no bucket names, no credentials, no exception text.
   * Whoever adds a field here next will be caught by this test rather than by
   * an operator finding their bucket name on the public internet.
   */
  const forbidden = [
    "http",
    "://",
    "localhost",
    "garage",
    "amazonaws",
    "redis",
    "password",
    "secret",
    "bucket",
    "endpoint",
    "credential",
    "Error",
    "at ",
  ]

  const combinations = [
    { database: "ok", storage: "connected" },
    { database: "ok", storage: "not_configured" },
    { database: "unavailable", storage: "connection_failed" },
    { database: "migrations_pending", storage: "not_configured" },
  ] as const

  for (const checks of combinations) {
    it(`emits states only for ${checks.database}/${checks.storage}`, () => {
      const { httpStatus: _omitted, ...wire } = buildReadinessReport(checks)
      const serialized = JSON.stringify(wire).toLowerCase()
      for (const leak of forbidden) {
        expect(serialized, `must not contain "${leak}"`).not.toContain(leak.toLowerCase())
      }
    })
  }

  it("carries no field beyond the documented six on the wire", () => {
    // `setup` joined in Phase 7.1, `captcha` in 7.1.1, `auth` in 7.1.2. Every one
    // of them is a fixed state string and nothing else — the list is asserted
    // exactly so a seventh field cannot appear without someone deciding it
    // should.
    const { httpStatus: _omitted, ...wire } = buildReadinessReport({
      database: "ok",
      storage: "connected",
    })
    expect(Object.keys(wire).sort()).toEqual(["auth", "captcha", "database", "setup", "status", "storage"])
  })
})

/**
 * "The application is operational" and "the CMS has been initialized" are
 * different questions, and this endpoint answers the first.
 *
 * An operator who has started the container and not yet filled in first-run
 * setup has a healthy application, not a failing one. Gating readiness on setup
 * would have the orchestrator restart the container while they were using the
 * setup form — the same mistake the storage rule above exists to avoid, at a
 * different layer.
 */
describe("setup state is reported, never gating", () => {
  it("is ready with setup incomplete", () => {
    const report = buildReadinessReport({ database: "ok", storage: "connected", setup: "incomplete" })
    expect(report.status).toBe("ready")
    expect(report.httpStatus).toBe(200)
    expect(report.setup).toBe("incomplete")
  })

  it("is ready with setup complete", () => {
    const report = buildReadinessReport({ database: "ok", storage: "connected", setup: "complete" })
    expect(report.status).toBe("ready")
    expect(report.setup).toBe("complete")
  })

  it("reports unknown rather than guessing when the database is down", () => {
    // "incomplete" would be a lie that an orchestrator's dashboard would show
    // as a fresh install during an outage.
    const report = buildReadinessReport({ database: "unavailable", storage: "connected", setup: "unknown" })
    expect(report.setup).toBe("unknown")
    expect(report.status).toBe("not_ready")
  })

  it("defaults to unknown when no setup state is supplied", () => {
    const report = buildReadinessReport({ database: "ok", storage: "connected" })
    expect(report.setup).toBe("unknown")
  })

  it("carries three states and nothing else — no token, no counts, no identity", () => {
    const report = buildReadinessReport({ database: "ok", storage: "connected", setup: "complete" })
    const payload = { ...report } as Partial<typeof report>
    delete payload.httpStatus
    expect(Object.keys(payload).sort()).toEqual(["auth", "captcha", "database", "setup", "status", "storage"])
    // Whether a setup token is configured is not readiness information, and
    // publishing it would tell an anonymous caller whether web setup is armed.
    expect(JSON.stringify(payload)).not.toMatch(/token/i)
  })
})

/**
 * `CAPTCHA_SECRET` is required for a functional installation, and unlike
 * storage it GATES readiness.
 *
 * The distinction is deliberate and worth stating, because the storage rule
 * above says the opposite for what looks like the same kind of problem:
 *
 *   STORAGE is DB-backed configuration. An operator fixes it in Settings, in
 *   the running container. Gating on it would have the orchestrator restart the
 *   container while they were typing the fix — taking away the screen they
 *   needed.
 *
 *   CAPTCHA_SECRET is ENV-ONLY configuration. It cannot be fixed from a running
 *   container at all; the fix IS a restart with the variable set. So gating
 *   costs the operator nothing and buys a loud, early, unmissable signal —
 *   instead of discovering it at the first sign-in attempt, after first-run
 *   setup has already completed into an installation nobody can administer.
 */
describe("captcha configuration gates readiness", () => {
  it("is NOT ready when the captcha secret is missing", () => {
    const report = buildReadinessReport({
      database: "ok",
      storage: "connected",
      setup: "complete",
      captcha: "missing",
    })
    expect(report.status).toBe("not_ready")
    expect(report.httpStatus).toBe(503)
    expect(report.captcha).toBe("missing")
  })

  it("is NOT ready when the captcha secret is unsafe", () => {
    const report = buildReadinessReport({
      database: "ok",
      storage: "connected",
      captcha: "unsafe",
    })
    expect(report.status).toBe("not_ready")
    expect(report.captcha).toBe("unsafe")
  })

  it("is ready when the captcha secret is usable", () => {
    const report = buildReadinessReport({
      database: "ok",
      storage: "connected",
      captcha: "usable",
    })
    expect(report.status).toBe("ready")
    expect(report.httpStatus).toBe(200)
  })

  it("stays not-ready when BOTH the database and the captcha config are broken", () => {
    const report = buildReadinessReport({
      database: "unavailable",
      storage: "connected",
      captcha: "missing",
    })
    expect(report.status).toBe("not_ready")
  })

  it("reports a state and nothing derived from the secret", () => {
    const report = buildReadinessReport({
      database: "ok",
      storage: "connected",
      captcha: "unsafe",
    })
    const serialized = JSON.stringify(report)
    // No value, no prefix, no hash, no length. Just the state.
    expect(serialized).not.toMatch(/secret/i)
    expect(serialized).not.toMatch(/length|chars|hash|sha/i)
  })

  it("carries exactly six fields on the wire, auth included", () => {
    const wire = { ...buildReadinessReport({ database: "ok", storage: "connected" }) } as Partial<
      ReturnType<typeof buildReadinessReport>
    >
    delete wire.httpStatus
    expect(Object.keys(wire).sort()).toEqual(["auth", "captcha", "database", "setup", "status", "storage"])
  })
})

/**
 * `AUTH_SECRET` gates readiness too (Phase 7.1.2), for the same reason
 * `CAPTCHA_SECRET` does: it is env-only configuration that cannot be corrected
 * from inside a running container, so the fix is a restart and gating costs the
 * operator nothing.
 *
 * The two are kept as SEPARATE components on purpose. Collapsing them into one
 * "secrets" status would tell an operator that something is wrong without
 * telling them which variable to set, and they fail in opposite ways: a bad
 * captcha secret fails closed and loud (nobody can sign in), a bad auth secret
 * fails open and silent (everyone can, including forgers).
 */
describe("auth configuration gates readiness", () => {
  const base = { database: "ok", storage: "connected", captcha: "usable" } as const

  it("is NOT ready when the auth secret is missing", () => {
    const report = buildReadinessReport({ ...base, auth: "missing" })
    expect(report.status).toBe("not_ready")
    expect(report.httpStatus).toBe(503)
    expect(report.auth).toBe("missing")
  })

  it("is NOT ready when the auth secret is unsafe", () => {
    const report = buildReadinessReport({ ...base, auth: "unsafe" })
    expect(report.status).toBe("not_ready")
    expect(report.auth).toBe("unsafe")
  })

  it("is ready when the auth secret is usable", () => {
    const report = buildReadinessReport({ ...base, auth: "usable" })
    expect(report.status).toBe("ready")
    expect(report.httpStatus).toBe(200)
  })

  it("defaults to unknown, which does not gate", () => {
    // Same rule as captcha: "I did not look" must not read as "it is broken".
    const report = buildReadinessReport({ database: "ok", storage: "connected" })
    expect(report.auth).toBe("unknown")
    expect(report.status).toBe("ready")
  })

  it("reports auth and captcha separately, never collapsed", () => {
    const report = buildReadinessReport({
      database: "ok",
      storage: "connected",
      captcha: "missing",
      auth: "unsafe",
    })
    expect(report.captcha).toBe("missing")
    expect(report.auth).toBe("unsafe")
    expect(report.status).toBe("not_ready")
  })

  it.each([
    ["both secrets valid", { captcha: "usable", auth: "usable" }, "ready"],
    ["auth invalid, captcha valid", { captcha: "usable", auth: "missing" }, "not_ready"],
    ["auth valid, captcha invalid", { captcha: "missing", auth: "usable" }, "not_ready"],
    ["both invalid", { captcha: "unsafe", auth: "unsafe" }, "not_ready"],
  ] as const)("%s → %s", (_label, secrets, expected) => {
    expect(buildReadinessReport({ database: "ok", storage: "connected", ...secrets }).status).toBe(
      expected,
    )
  })

  it("leaks nothing about either secret", () => {
    const report = buildReadinessReport({ ...base, auth: "unsafe" })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toMatch(/secret/i)
    expect(serialized).not.toMatch(/length|chars|hash|sha|prefix/i)
  })

  it("carries exactly six fields on the wire", () => {
    const wire = { ...buildReadinessReport({ database: "ok", storage: "connected" }) } as Partial<
      ReturnType<typeof buildReadinessReport>
    >
    delete wire.httpStatus
    expect(Object.keys(wire).sort()).toEqual([
      "auth",
      "captcha",
      "database",
      "setup",
      "status",
      "storage",
    ])
  })
})
