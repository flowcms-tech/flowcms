import { afterEach, describe, expect, it, vi } from "vitest"
import type Redis from "ioredis"

/**
 * ONE REDIS CLIENT PER PROCESS, NOT ONE PER EVALUATION OF `redisClient.ts`.
 *
 * The same leak as issue #18, in the cache layer. `next dev` re-evaluates
 * server modules after a save without restarting Node; the client lived in a
 * module-scope `let`, so every re-evaluation reset it to null and the next
 * `getRedisClient()` opened another connection while the previous one stayed
 * open with nothing left to close it.
 *
 * `vi.resetModules()` followed by a fresh import is the same event: the module
 * registry is thrown away, the process and its `globalThis` are not.
 *
 * The client is created with `lazyConnect`, so no Redis server is contacted.
 * Each case uses its own URL so no case can pass on another's client.
 *
 * Identity is asserted as a boolean: a failing `toBe` between two clients makes
 * vitest diff both object graphs instead of reporting the failure.
 */

const created: Redis[] = []

async function evaluateClient(url: string | undefined): Promise<Redis | null> {
  if (url === undefined) vi.stubEnv("REDIS_URL", "")
  else vi.stubEnv("REDIS_URL", url)
  vi.resetModules()
  const { getRedisClient } = await import("@/Framework/Redis/redisClient")
  const client = getRedisClient()
  if (client) created.push(client)
  return client
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const client of created.splice(0)) client.disconnect()
})

describe("the Redis client across module re-evaluation", () => {
  it("reuses the client instead of opening a second connection", async () => {
    const url = "redis://127.0.0.1:1/1"
    const first = await evaluateClient(url)
    const second = await evaluateClient(url)

    expect(first).not.toBeNull()
    expect(second === first, "a second Redis client was created").toBe(true)
  })

  it("leaves the reused client open", async () => {
    const url = "redis://127.0.0.1:1/2"
    await evaluateClient(url)
    const second = await evaluateClient(url)

    expect(second?.status).not.toBe("end")
  })

  it("follows a changed REDIS_URL, and closes the client it replaces", async () => {
    const first = await evaluateClient("redis://127.0.0.1:1/3")
    const second = await evaluateClient("redis://127.0.0.1:1/4")

    expect(second === first, "the old client was reused").toBe(false)
    expect(second?.status).not.toBe("end")
    expect(first?.status).toBe("end")
  })

  it("closes the client when REDIS_URL is removed", async () => {
    const first = await evaluateClient("redis://127.0.0.1:1/5")
    const second = await evaluateClient(undefined)

    expect(second).toBeNull()
    expect(first?.status).toBe("end")
  })
})
