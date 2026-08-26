import { describe, expect, it } from "vitest"
import { LIKE_ESCAPE_CHAR, escapeLikePattern } from "@/db/likeEscape"

describe("escapeLikePattern", () => {
  it("neutralises the multi-character wildcard", () => {
    // The attack: an object key of "%" turns `LIKE '%.../%%'` into a pattern
    // that matches every row, so an unrelated published post authorises an
    // arbitrary private object.
    expect(escapeLikePattern("%")).toBe(`${LIKE_ESCAPE_CHAR}%`)
    expect(escapeLikePattern("a%b")).toBe(`a${LIKE_ESCAPE_CHAR}%b`)
  })

  it("neutralises the single-character wildcard", () => {
    expect(escapeLikePattern("_")).toBe(`${LIKE_ESCAPE_CHAR}_`)
    expect(escapeLikePattern("a_b")).toBe(`a${LIKE_ESCAPE_CHAR}_b`)
  })

  it("escapes the escape character itself, first", () => {
    // If the escape char were not escaped first, escaping it afterwards would
    // corrupt the escapes introduced for % and _.
    const escaped = escapeLikePattern(LIKE_ESCAPE_CHAR)
    expect(escaped).toBe(LIKE_ESCAPE_CHAR + LIKE_ESCAPE_CHAR)
  })

  it("keeps an ordinary key untouched", () => {
    expect(escapeLikePattern("posts/2026/cover-image.jpg")).toBe("posts/2026/cover-image.jpg")
  })

  it("handles a key combining all three special characters", () => {
    const out = escapeLikePattern(`50${LIKE_ESCAPE_CHAR}%_off.jpg`)
    expect(out).toBe(
      `50${LIKE_ESCAPE_CHAR}${LIKE_ESCAPE_CHAR}${LIKE_ESCAPE_CHAR}%${LIKE_ESCAPE_CHAR}_off.jpg`
    )
  })

  it("leaves underscores in ordinary filenames escaped but readable", () => {
    // Underscores are common in real filenames, so escaping (rather than
    // rejecting) is what keeps legitimate images working.
    expect(escapeLikePattern("my_photo.png")).toBe(`my${LIKE_ESCAPE_CHAR}_photo.png`)
  })

  it("is a pure function over strings", () => {
    expect(escapeLikePattern("")).toBe("")
  })
})
