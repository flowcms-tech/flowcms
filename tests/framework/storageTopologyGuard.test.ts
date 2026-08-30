import { describe, expect, it } from "vitest"
import { rejectTopologyChange } from "@/Framework/Storage/storageTopologyGuard"

/**
 * THE FOOTGUN THIS WHOLE REFACTOR EXISTS TO REMOVE.
 *
 * Admin > Settings > Storage let an owner type a different bucket name and
 * press Save. The next request resolved a new bucket, and every image on the
 * site was gone — no warning, no migration, no way back except remembering the
 * old value. Nothing copied a single file.
 *
 * Changing WHERE files live is a migration: test the destination, decide
 * whether to copy, verify, then cut over. That workflow is a later phase. Until
 * it exists, a relocation is refused rather than half-supported.
 *
 * What is NOT refused is a credential rotation. Replacing an access key points
 * at the same bucket on the same endpoint, no file moves, and an operator whose
 * key has leaked must be able to fix that immediately.
 */

/** Currently effective values, as `getS3Config`-style resolution produces. */
const CURRENT = {
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  bucket: "flowcms-media",
}

describe("edits that move where files live", () => {
  it.each([
    ["bucket", { bucket: "somewhere-else" }],
    ["endpoint", { endpoint: "https://r2.example.com" }],
    ["region", { region: "eu-west-1" }],
  ])("refuses a change of %s", (_label, change) => {
    const problem = rejectTopologyChange(CURRENT, change)

    expect(problem).toBeTruthy()
    expect(problem).toMatch(/migrat/i)
  })

  it("refuses a change of several at once", () => {
    expect(
      rejectTopologyChange(CURRENT, { bucket: "b", endpoint: "https://other.example.com" }),
    ).toBeTruthy()
  })

  it("names the field, so the operator knows what was refused", () => {
    expect(rejectTopologyChange(CURRENT, { bucket: "elsewhere" })).toMatch(/bucket/i)
  })

  it("never quotes the submitted value back", () => {
    // An endpoint may carry credentials in its userinfo, and a rejected value
    // echoed into a response is a credential in a log.
    const problem = rejectTopologyChange(CURRENT, {
      endpoint: "https://key:secret@evil.example.com",
    })

    expect(problem).not.toContain("secret")
    expect(problem).not.toContain("evil.example.com")
  })
})

describe("edits that do not move anything", () => {
  it("allows a submission that changes nothing", () => {
    // The form posts every field it renders, so an operator who edited only
    // their access key still submits the bucket. Re-sending the same value must
    // not read as a relocation.
    expect(rejectTopologyChange(CURRENT, { ...CURRENT })).toBeNull()
  })

  it("allows a submission that omits the topology fields entirely", () => {
    expect(rejectTopologyChange(CURRENT, {})).toBeNull()
  })

  it("allows a credential rotation", () => {
    // Access key and secret are not topology. Same bucket, same endpoint, no
    // file moves — and an operator with a leaked key needs this to be instant.
    expect(rejectTopologyChange(CURRENT, { accessKeyId: "AKIA-NEW" } as never)).toBeNull()
  })

  it("treats a blank field as 'leave it alone', not as a move to nowhere", () => {
    // Empty means "clear this override and fall back to the environment
    // variable" in this settings form. It is not a request to relocate.
    expect(rejectTopologyChange(CURRENT, { bucket: "", endpoint: "", region: "" })).toBeNull()
  })

  it("ignores a trailing slash on the endpoint", () => {
    expect(rejectTopologyChange(CURRENT, { endpoint: "https://s3.example.com/" })).toBeNull()
  })

  it("ignores surrounding whitespace", () => {
    expect(rejectTopologyChange(CURRENT, { bucket: "  flowcms-media  " })).toBeNull()
  })
})

describe("establishing configuration for the first time", () => {
  it("allows setting a bucket when there is none yet", () => {
    // A fresh install whose operator is configuring storage for the first time
    // is not relocating anything — there is nothing to relocate.
    expect(
      rejectTopologyChange({ endpoint: undefined, region: undefined, bucket: "" }, { bucket: "first" }),
    ).toBeNull()
  })

  it("allows setting an endpoint when there is none yet", () => {
    expect(
      rejectTopologyChange(
        { endpoint: undefined, region: "us-east-1", bucket: "flowcms-media" },
        { endpoint: "https://s3.example.com" },
      ),
    ).toBeNull()
  })

  it("still refuses to change a bucket that was just established", () => {
    expect(rejectTopologyChange({ ...CURRENT, bucket: "first" }, { bucket: "second" })).toBeTruthy()
  })
})
