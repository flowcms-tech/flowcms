import { beforeEach, describe, expect, it } from "vitest"
import {
  __resetInMemoryRateLimitStore,
  consumeRateLimit,
  resetRateLimit,
} from "@/Framework/RateLimit/RateLimiter"

// No REDIS_URL in the test environment, so every case here exercises the
// in-memory fallback — which is exactly the path that has to keep working when
// an operator has not configured Redis, or when Redis goes down mid-incident.
describe("consumeRateLimit (no Redis configured)", () => {
  beforeEach(() => {
    __resetInMemoryRateLimitStore()
  })

  it("allows attempts up to the limit and blocks the one after", async () => {
    const opts = { key: "login:ip:1.2.3.4", limit: 3, windowSeconds: 60 }

    expect((await consumeRateLimit(opts)).limited).toBe(false)
    expect((await consumeRateLimit(opts)).limited).toBe(false)
    expect((await consumeRateLimit(opts)).limited).toBe(false)

    const fourth = await consumeRateLimit(opts)
    expect(fourth.limited).toBe(true)
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0)
  })

  it("counts each key independently", async () => {
    const a = { key: "login:ip:10.0.0.1", limit: 1, windowSeconds: 60 }
    const b = { key: "login:ip:10.0.0.2", limit: 1, windowSeconds: 60 }

    expect((await consumeRateLimit(a)).limited).toBe(false)
    expect((await consumeRateLimit(a)).limited).toBe(true)
    // b must be untouched by a's exhaustion.
    expect((await consumeRateLimit(b)).limited).toBe(false)
  })

  it("forgets a window once it has elapsed", async () => {
    let clock = 1_000_000
    const now = () => clock
    const opts = { key: "login:email:a@example.com", limit: 1, windowSeconds: 60, now }

    expect((await consumeRateLimit(opts)).limited).toBe(false)
    expect((await consumeRateLimit(opts)).limited).toBe(true)

    clock += 61_000
    expect((await consumeRateLimit(opts)).limited).toBe(false)
  })

  it("reports a retry-after that shrinks as the window elapses", async () => {
    let clock = 5_000_000
    const now = () => clock
    const opts = { key: "login:ip:9.9.9.9", limit: 1, windowSeconds: 100, now }

    await consumeRateLimit(opts)
    const immediately = await consumeRateLimit(opts)
    clock += 90_000
    const later = await consumeRateLimit(opts)

    expect(immediately.retryAfterSeconds).toBeGreaterThan(later.retryAfterSeconds)
  })

  it("clears a counter on reset, which is what a successful login does", async () => {
    const opts = { key: "login:email:b@example.com", limit: 1, windowSeconds: 60 }

    expect((await consumeRateLimit(opts)).limited).toBe(false)
    expect((await consumeRateLimit(opts)).limited).toBe(true)

    await resetRateLimit(opts.key)
    expect((await consumeRateLimit(opts)).limited).toBe(false)
  })

  it("never throws, whatever the backend does", async () => {
    // The contract the login path depends on: a limiter failure must not be
    // able to lock every legitimate user out of the admin panel.
    await expect(
      consumeRateLimit({ key: "", limit: 0, windowSeconds: 0 })
    ).resolves.toBeDefined()
  })
})
