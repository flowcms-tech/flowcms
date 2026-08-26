import { describe, expect, it } from "vitest"
import { StorageService } from "@/Framework/Storage/StorageService"

/**
 * Two-phase persistence check, run either side of a Garage restart.
 *
 *   SMOKE_MODE=write   → put an object and leave it there
 *   SMOKE_MODE=verify  → read it back, then clean up
 *
 * Between the phases the Garage container is restarted. Passing `verify` proves
 * three separate things at once, each of which a naive "the container came back
 * up" check would miss:
 *
 *   1. the object survived      → data volumes are wired correctly
 *   2. the credentials still work → bootstrap did not regenerate the key
 *   3. the bucket still exists   → --default-bucket is idempotent, not
 *                                   destructive-and-recreating
 *
 * Outside `tests/` on purpose: it needs a live backend and an orchestrated
 * restart between runs, so it must never join the ordinary suite.
 */

const KEY = "phase4-smoke/persistence.txt"
const BODY = Buffer.from("survives a garage restart\n", "utf8")
// NOT `MODE`: Vite/Vitest sets process.env.MODE to "test" itself, which
// silently clobbers any value passed in and skips every branch.
const MODE = process.env.SMOKE_MODE ?? "write"

describe(`Garage persistence [${MODE}]`, () => {
  if (MODE === "write") it("writes an object before the restart", async () => {
    await StorageService.uploadObject(KEY, BODY, "text/plain")
    const listed = await StorageService.listObjects("phase4-smoke/")
    expect(listed.map((o) => o.key)).toContain(KEY)
  }, 60_000)

  if (MODE === "verify") it("still has the object, and the same credentials still work", async () => {
    // Reaching this line at all means the access key was accepted — a
    // regenerated credential would have failed the request, not the assertion.
    const listed = await StorageService.listObjects("phase4-smoke/")
    expect(listed.map((o) => o.key)).toContain(KEY)

    const downloaded = await StorageService.downloadObject(KEY)
    expect(Buffer.from(downloaded).toString("utf8")).toBe(BODY.toString("utf8"))

    await StorageService.deleteObject(KEY)
  }, 60_000)
})
