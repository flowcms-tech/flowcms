import { describe, expect, it } from "vitest"
import { StorageService } from "@/Framework/Storage/StorageService"

/**
 * Integration smoke test: FlowCMS's own storage abstraction against a live
 * S3-compatible backend.
 *
 * Deliberately NOT part of the normal suite — it lives outside `tests/` so
 * `vitest run` never picks it up, because it requires a reachable object store
 * and the rest of the suite requires nothing at all.
 *
 * It exists to test one claim, and only that claim: **FlowCMS needs no
 * Garage-specific behaviour.** An ad-hoc script written against the AWS SDK
 * would prove that the AWS SDK can talk to Garage, which nobody doubts and
 * which is not the question. Driving `StorageService` proves that the exact
 * code path the File Manager and the editor use works unmodified against
 * Garage — and by extension against any S3-compatible provider, since the
 * abstraction cannot tell which one answered.
 *
 * Presigning is deliberately NOT exercised: Phase 2 removed it from the storage
 * contract. It used to be step 3 here, and it passed — from INSIDE the Docker
 * network, where `http://garage:3900` resolves. That is exactly why it was a
 * misleading check: the browser is not inside the Docker network, so the URL
 * this test proved "works" was unreachable for every real user.
 *
 * Run inside the app's Docker network:
 *   docker run --rm --network flowcms_default \
 *     -e S3_ENDPOINT=http://garage:3900 ... flowcms:builder \
 *     npx vitest run tests/storage-roundtrip.test.ts
 */

const KEY = `phase4-smoke/roundtrip-${process.env.SMOKE_ID ?? "local"}.txt`
const BODY = Buffer.from("FlowCMS Phase 4 storage round trip\n", "utf8")

describe("StorageService against the configured S3 backend", () => {
  it("uploads, reads back, lists and deletes", async () => {
    // 1. upload
    await StorageService.uploadObject(KEY, BODY, "text/plain")

    // 2. read back through the same abstraction
    const downloaded = await StorageService.downloadObject(KEY)
    expect(Buffer.from(downloaded).toString("utf8")).toBe(BODY.toString("utf8"))

    // 3. list
    const listed = await StorageService.listObjects("phase4-smoke/")
    expect(listed.map((o) => o.key)).toContain(KEY)

    // 4. delete, and confirm it is gone
    await StorageService.deleteObject(KEY)
    const after = await StorageService.listObjects("phase4-smoke/")
    expect(after.map((o) => o.key)).not.toContain(KEY)
  }, 60_000)
})
