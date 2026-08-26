import { describe, expect, it } from "vitest"
import { parseDate } from "@/Framework/Functions/DateFunctions"

/**
 * `parseDate` used to be the Jalali formatter this codebase inherited from a
 * Persian payment panel: eleven methods, nine of them Persian, driven by
 * `jalaali-js` and Eastern Arabic numerals. Three admin modules used it, and
 * all three called only the two Gregorian methods.
 *
 * What is left is those two plus the times, renamed — "Gregorian" is a word
 * that only means something in contrast to a calendar that is no longer here.
 * The tests below pin the shapes the table columns actually render, because a
 * date column that silently loses its zero padding is the sort of thing nobody
 * notices until a sort order looks wrong.
 *
 * Every assertion uses a LOCAL-time literal (no trailing `Z`). `parseDate`
 * formats in local time by design — the admin panel shows an operator their own
 * clock — so a UTC literal would make these assertions depend on the machine's
 * timezone rather than on the code.
 */

describe("parseDate", () => {
  it("formats a date as ISO-ordered yyyy-MM-dd", () => {
    expect(parseDate("2026-06-07T03:48:17").toDate()).toBe("2026-06-07")
  })

  it("zero-pads single-digit months, days, hours, minutes and seconds", () => {
    const d = parseDate("2026-01-02T03:04:05")
    expect(d.toDate()).toBe("2026-01-02")
    expect(d.toDateTime()).toBe("2026-01-02 03:04:05")
    expect(d.toTime()).toBe("03:04")
    expect(d.toTimeFull()).toBe("03:04:05")
  })

  it("keeps two-digit components intact", () => {
    const d = parseDate("2026-11-23T14:35:59")
    expect(d.toDate()).toBe("2026-11-23")
    expect(d.toDateTime()).toBe("2026-11-23 14:35:59")
    expect(d.toTime()).toBe("14:35")
  })

  it("exposes the underlying Date unchanged", () => {
    const raw = parseDate("2026-06-07T03:48:17").raw
    expect(raw).toBeInstanceOf(Date)
    expect(raw.getTime()).toBe(new Date("2026-06-07T03:48:17").getTime())
  })

  it("renders a UTC timestamp in the reader's local time, consistently", () => {
    // The database stores UTC. Whatever the runner's timezone is, the parts
    // must agree with the Date object they were derived from — this catches a
    // formatter that reaches for the UTC getters for one component and the
    // local ones for another, which is how a date lands a day off at midnight.
    const d = parseDate("2026-06-07T23:48:17.000Z")
    const r = d.raw
    const pad = (n: number) => String(n).padStart(2, "0")
    expect(d.toDate()).toBe(
      `${r.getFullYear()}-${pad(r.getMonth() + 1)}-${pad(r.getDate())}`,
    )
    expect(d.toTimeFull()).toBe(
      `${pad(r.getHours())}:${pad(r.getMinutes())}:${pad(r.getSeconds())}`,
    )
  })

  it("carries no calendar-specific API", () => {
    // The Jalali methods are gone and must not return under another name. This
    // is a shape assertion rather than a behaviour one on purpose: the module
    // is small enough that its whole public surface is worth pinning.
    expect(Object.keys(parseDate("2026-06-07T03:48:17")).sort()).toEqual([
      "raw",
      "toDate",
      "toDateTime",
      "toTime",
      "toTimeFull",
    ])
  })
})
