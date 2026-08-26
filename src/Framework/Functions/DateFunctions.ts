/**
 * Date formatting for the admin panel.
 *
 * FlowCMS is English and LTR, and every value it formats arrives as an ISO
 * string from the database. `parseDate` therefore does one thing: it reads that
 * string once and hands back the few shapes the tables actually render, so a
 * column cell is a method call rather than another hand-rolled `padStart`.
 *
 * Deliberately calendar-neutral. This module was Jalali-only in the project this
 * codebase grew out of; the Persian calendar and its `jalaali-js` dependency
 * were removed with the rest of that product, and nothing here should reacquire
 * a locale argument. A theme or an admin screen that needs a different
 * presentation should use `Intl.DateTimeFormat` at the point of use, where the
 * locale is known.
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export interface ParsedDate {
  /** 2026-06-07 */
  toDate(): string
  /** 2026-06-07 03:48:17 */
  toDateTime(): string
  /** 03:48 */
  toTime(): string
  /** 03:48:17 */
  toTimeFull(): string
  /** Raw JS Date object */
  raw: Date
}

export function parseDate(dateStr: string): ParsedDate {
  const date = new Date(dateStr)

  const h = date.getHours()
  const min = date.getMinutes()
  const sec = date.getSeconds()

  const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  const time = `${pad2(h)}:${pad2(min)}`
  const timeFull = `${time}:${pad2(sec)}`

  return {
    toDate: () => day,
    toDateTime: () => `${day} ${timeFull}`,
    toTime: () => time,
    toTimeFull: () => timeFull,
    raw: date,
  }
}
