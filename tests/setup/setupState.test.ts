import { describe, expect, it } from "vitest"
import { classifySetupState } from "@/Framework/Setup/setupState"

/**
 * The classification, as a pure function of the stored row.
 *
 * Split out from the query for the same reason `buildReadinessReport` is: the
 * policy is what has to be right, and it can be pinned exhaustively without a
 * database.
 */

describe("classifySetupState", () => {
  it("calls a null marker incomplete", () => {
    expect(classifySetupState({ setupCompletedAt: null }).state).toBe("incomplete")
  })

  it("calls a missing row incomplete", () => {
    // A fresh install has no settings row at all — the public site has to
    // render before anyone has configured anything. The absence of a row is a
    // DEFINITE answer, not an unknown one.
    expect(classifySetupState(null).state).toBe("incomplete")
    expect(classifySetupState(undefined).state).toBe("incomplete")
  })

  it("calls a Date marker complete, and reports when", () => {
    const status = classifySetupState({ setupCompletedAt: new Date(1_700_000_000_000) })
    expect(status.state).toBe("complete")
    expect(status.state === "complete" && status.completedAt?.getTime()).toBe(1_700_000_000_000)
  })

  it("calls a numeric marker complete", () => {
    // PostgreSQL's bigint and MySQL's bigint can arrive as a number rather than
    // a Date depending on the driver's type parsing.
    const status = classifySetupState({ setupCompletedAt: 1_700_000_000_000 })
    expect(status.state).toBe("complete")
  })

  it("calls epoch zero complete", () => {
    // 0 is falsy and is a real timestamp. A `if (marker)` check here would
    // reopen setup on an installation initialized at the epoch — contrived, but
    // the bug class is not, and the fix costs one `=== null`.
    expect(classifySetupState({ setupCompletedAt: 0 }).state).toBe("complete")
    expect(classifySetupState({ setupCompletedAt: new Date(0) }).state).toBe("complete")
  })

  it("stays complete even when the stored timestamp will not parse", () => {
    // Refusing to call it complete because the value is malformed would reopen
    // public first-run setup over a cosmetic defect — the exact outcome the
    // marker exists to prevent.
    const status = classifySetupState({ setupCompletedAt: Number.NaN })
    expect(status.state).toBe("complete")
    expect(status.state === "complete" && status.completedAt).toBeNull()
  })

  it("never returns blocked from the pure classifier", () => {
    // `blocked` describes a failure to READ, which this function cannot
    // observe. Only the query wrapper can produce it.
    for (const row of [null, { setupCompletedAt: null }, { setupCompletedAt: 1 }]) {
      expect(classifySetupState(row).state).not.toBe("blocked")
    }
  })
})
