import { describe, expect, it } from "vitest"
import { normalizeEmail } from "@/Framework/Auth/identity"
import { slugPattern } from "@/Modules/Blog/Posts/Values/Validations"

/**
 * Identity semantics that must not depend on which database answered.
 *
 * MySQL and MariaDB default to case-insensitive collation; PostgreSQL and
 * SQLite compare case-sensitively. Left to the database, one FlowCMS install
 * would treat `User@example.com` and `user@example.com` as two accounts and
 * another would treat them as one — and the login lookup, being case-sensitive
 * in code, would fail to find an account its own signup had just created.
 *
 * So the contract is enforced in the application and the database merely
 * stores the result. Collation becomes a performance detail rather than a
 * behavioural one.
 */

describe("normalizeEmail", () => {
  it("lowercases, so case cannot create a second account", () => {
    expect(normalizeEmail("User@Example.COM")).toBe("user@example.com")
  })

  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  user@example.com \n")).toBe("user@example.com")
  })

  it("is idempotent", () => {
    const once = normalizeEmail("User@Example.com")
    expect(normalizeEmail(once)).toBe(once)
  })

  it("maps every casing of one address to a single identity", () => {
    const variants = [
      "user@example.com",
      "USER@EXAMPLE.COM",
      "User@Example.Com",
      "  uSeR@eXaMpLe.cOm  ",
    ]
    expect(new Set(variants.map(normalizeEmail)).size).toBe(1)
  })

  it("does not otherwise rewrite the address", () => {
    // Plus-addressing and dots are meaningful to some providers; normalising
    // them away would merge addresses their owners consider distinct.
    expect(normalizeEmail("first.last+tag@example.com")).toBe("first.last+tag@example.com")
  })

  it("leaves distinct addresses distinct", () => {
    expect(normalizeEmail("a@example.com")).not.toBe(normalizeEmail("b@example.com"))
  })
})

describe("slug identity is restricted, not normalized", () => {
  /**
   * Slugs need no normalization layer because uppercase never reaches the
   * database: the shared Zod schema rejects it outright. That is a stronger
   * guarantee than lowercasing — the operator is told their input was wrong
   * instead of silently getting a different URL than they typed — and it is
   * already identical on all four engines.
   */
  it("accepts canonical lowercase slugs", () => {
    for (const slug of ["my-post", "post-2", "a", "a-b-c"]) {
      expect(slugPattern.test(slug), slug).toBe(true)
    }
  })

  it("rejects uppercase rather than silently lowercasing it", () => {
    for (const slug of ["My-Post", "POST", "My-POST"]) {
      expect(slugPattern.test(slug), slug).toBe(false)
    }
  })

  it("rejects shapes that would differ across engines or URLs", () => {
    for (const slug of ["my post", "my_post", "-leading", "trailing-", "my--post", ""]) {
      expect(slugPattern.test(slug), JSON.stringify(slug)).toBe(false)
    }
  })
})
