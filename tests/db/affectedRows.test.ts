import { describe, expect, it } from "vitest"
import { affectedRowCount, isUniqueViolation } from "@/db/writes"

/**
 * "Did my conditional UPDATE match anything?" — the primitive the first-run
 * setup race depends on.
 *
 * Setup claims the installation with
 *
 *   UPDATE settings SET setupCompletedAt = ? WHERE id = 'global' AND setupCompletedAt IS NULL
 *
 * and the answer to "did exactly one row change" is what separates the winner
 * from the loser of two concurrent attempts. Get it wrong in the permissive
 * direction and a FlowCMS install ends up with two owners created by two
 * different people.
 *
 * Three drivers report it three ways, and none of them is on the canonical
 * SQLite type the application compiles against. So the normalizer lives in
 * `src/db/writes.ts` with the rest of the dialect knowledge, and this pins the
 * shapes.
 *
 * The shapes here are the ones the real drivers return; the four-engine matrix
 * proves the live results agree, and `tests/setup/setupBoundary.test.ts` drives
 * the claim itself.
 */

describe("affectedRowCount across driver result shapes", () => {
  it("reads libsql's rowsAffected", () => {
    // @libsql/client ResultSet
    expect(affectedRowCount({ rowsAffected: 1, rows: [], columns: [] })).toBe(1)
    expect(affectedRowCount({ rowsAffected: 0, rows: [], columns: [] })).toBe(0)
  })

  it("reads postgres.js's count", () => {
    // postgres.js returns a RowList — an array carrying a `count` property.
    const rowList = Object.assign([], { count: 1, command: "UPDATE" })
    expect(affectedRowCount(rowList)).toBe(1)
    expect(affectedRowCount(Object.assign([], { count: 0, command: "UPDATE" }))).toBe(0)
  })

  it("reads mysql2's affectedRows out of the result header", () => {
    // drizzle's mysql2 driver returns [ResultSetHeader, FieldPacket[]].
    expect(affectedRowCount([{ affectedRows: 1, changedRows: 1 }, []])).toBe(1)
    expect(affectedRowCount([{ affectedRows: 0, changedRows: 0 }, []])).toBe(0)
  })

  it("prefers affectedRows over changedRows on MySQL", () => {
    // MySQL's changedRows excludes rows whose new values equal the old ones. A
    // claim that wrote the same timestamp twice would report changedRows: 0 and
    // be read as "I lost" while actually having won.
    expect(affectedRowCount([{ affectedRows: 1, changedRows: 0 }, []])).toBe(1)
  })

  it("returns 0 for a shape it does not recognise, never a truthy guess", () => {
    // FAILS CLOSED. An unrecognised result must read as "I did not win": the
    // loser of a race retries nothing, while a false winner creates a second
    // owner. If a driver upgrade changes the shape, setup stops working loudly
    // instead of duplicating ownership quietly.
    expect(affectedRowCount(undefined)).toBe(0)
    expect(affectedRowCount(null)).toBe(0)
    expect(affectedRowCount({})).toBe(0)
    expect(affectedRowCount([])).toBe(0)
    expect(affectedRowCount("1")).toBe(0)
    expect(affectedRowCount(1)).toBe(0)
  })

  it("does not mistake a plain array of returned rows for a count", () => {
    // SQLite and PostgreSQL can return rows from an UPDATE ... RETURNING. Those
    // are data, not a count, and reading `length` here would report a win for
    // any statement that happened to return rows.
    expect(affectedRowCount([{ id: "global" }])).toBe(0)
  })
})

/**
 * "Did this write lose a race on a unique constraint?"
 *
 * Setup's completion transaction depends on the answer: on a genuinely fresh
 * installation there is no settings row, so the primary key `'global'` is the
 * race guard, and the loser must be translated into a clean "already completed"
 * conflict rather than a 500.
 *
 * THE FOUR-ENGINE MATRIX CAUGHT THIS. Matching only `error.message` works on
 * SQLite, where libsql throws the driver error directly, and fails on
 * PostgreSQL, where Drizzle wraps it — the outer message is
 * `Failed query: insert into "settings" (…)` with no hint of a constraint, and
 * the real text sits one level down in `cause`.
 */
describe("isUniqueViolation across driver error shapes", () => {
  it("sees libsql's message directly", () => {
    expect(isUniqueViolation(new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: settings.id"))).toBe(true)
  })

  it("sees PostgreSQL's violation through Drizzle's wrapper", () => {
    // The exact shape observed on PostgreSQL 17 via postgres.js.
    const inner = Object.assign(new Error('duplicate key value violates unique constraint "settings_pkey"'), {
      code: "23505",
    })
    const wrapped = Object.assign(new Error('Failed query: insert into "settings" ("id", "siteName", …)'), {
      cause: inner,
    })
    expect(isUniqueViolation(wrapped)).toBe(true)
    // And the wrapper ALONE must not be enough — that is the bug being pinned.
    expect(isUniqueViolation(new Error('Failed query: insert into "settings" ("id", "siteName", …)'))).toBe(false)
  })

  it("sees MySQL's ER_DUP_ENTRY through the wrapper", () => {
    const inner = Object.assign(new Error("Duplicate entry 'global' for key 'settings.PRIMARY'"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
    })
    expect(isUniqueViolation(Object.assign(new Error("Failed query"), { cause: inner }))).toBe(true)
  })

  it("recognises a SQLSTATE code even when the message says nothing", () => {
    expect(isUniqueViolation(Object.assign(new Error("write failed"), { code: "23505" }))).toBe(true)
  })

  it("does NOT swallow an unrelated failure", () => {
    // Critical: a disk error, a dropped connection or an injected fault must
    // propagate. Classifying them as "someone else won the race" would report a
    // broken database as a completed setup.
    expect(isUniqueViolation(new Error("connection terminated unexpectedly"))).toBe(false)
    expect(isUniqueViolation(new Error("injected: storage went away mid-setup"))).toBe(false)
    expect(
      isUniqueViolation(
        Object.assign(new Error("Failed query"), {
          cause: Object.assign(new Error("deadlock detected"), { code: "40P01" }),
        }),
      ),
    ).toBe(false)
  })

  it("terminates on a cyclic cause chain", () => {
    // A limiter that hangs inside a request handler is worse than one that
    // returns the wrong answer.
    const a = new Error("a") as Error & { cause?: unknown }
    const b = new Error("b") as Error & { cause?: unknown }
    a.cause = b
    b.cause = a
    expect(() => isUniqueViolation(a)).not.toThrow()
    expect(isUniqueViolation(a)).toBe(false)
  })

  it("tolerates non-Error values", () => {
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
    expect(isUniqueViolation("duplicate key")).toBe(false)
  })
})
