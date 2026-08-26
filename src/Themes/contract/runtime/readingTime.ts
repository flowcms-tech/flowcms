/**
 * Reading time, derived from a stored word count.
 *
 * Lives here rather than in the content analyser because it is part of the
 * PUBLIC theme contract and the analyser is not. `contentStats.ts` is 250 lines
 * of HTML scanning that exists for the admin SEO panel; packaging all of it so
 * a theme could divide by 200 would ship the analyser to every theme author and
 * put its internals inside the published type surface.
 *
 * 200 wpm, floored at one minute. Derived at render rather than stored — one
 * number, one truth, and the divisor stays tunable without a migration.
 */
export function readingTimeMinutes(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 200))
}
