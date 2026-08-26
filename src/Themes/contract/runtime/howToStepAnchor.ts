/**
 * The anchor for step N of a rendered HowTo.
 *
 * AN AGREEMENT BETWEEN TWO PLACES, which is why a theme is given it rather than
 * left to invent one: the JSON-LD `HowToStep.url` core emits points at
 * `#howto-step-3`, and the visible list item a theme renders has to carry the
 * same id or the structured data references anchors that do not exist.
 *
 * Extracted from `buildJsonLd.ts` in Phase 7.2. The function was always one
 * line; the MODULE it lived in is the JSON-LD builder, and a published
 * `flowcms/theme` that packaged it would ship every structured-data builder in
 * FlowCMS to theme authors — the exact capability the contract exists to keep
 * away from themes.
 */
export function howToStepAnchor(index: number): string {
  return `howto-step-${index + 1}`
}
