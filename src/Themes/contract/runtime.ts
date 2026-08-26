/**
 * The runtime half of the theme contract: the components and helpers a theme
 * may call, as opposed to the types it renders from.
 *
 * Everything here is CORE-OWNED. A theme calls it; a theme never reimplements
 * it. Two different reasons put things on this list, and they are worth keeping
 * straight:
 *
 *   1. SECURITY BOUNDARIES. `JsonLd` escapes its payload. If a theme could
 *      hand-roll it, every theme author would inherit an escaping bug and the
 *      operator would never know. The custom page renderer was already
 *      injectable once for precisely this reason — a raw `JSON.stringify` in a
 *      component, with a comment asserting it was safe.
 *
 *   2. AGREEMENTS BETWEEN CORE AND MARKUP. `howToStepAnchor` has to produce the
 *      same id the JSON-LD `HowToStep.url` points at, and `publicImagePath` has
 *      to produce a URL that survives a crawler revisiting a week later. Both
 *      are contracts between two places, so neither belongs to one theme.
 *
 * `cn` is here for neither reason — it is a convenience so themes get the same
 * Tailwind class-merge behaviour as the rest of the app without adding their
 * own copy of clsx and tailwind-merge.
 *
 * WHAT CHANGED IN PHASE 7.2. This file used to re-export from `@/Framework/**`
 * and `@/Modules/**`. Every implementation now lives under `./runtime/`, and
 * those former locations re-export from here instead. The arrow had to invert:
 * a published `flowcms/theme` must CONTAIN what it exposes, and re-exporting
 * across the application would either drag the application into the package or
 * ship a `.d.ts` full of `@/…` specifiers no consumer can resolve.
 *
 * `AskQuestionForm` is deliberately absent. It was audited out here rather than
 * packaged: see `BlogPostView.askQuestion` in `./views`.
 */

export { default as JsonLd } from "./runtime/JsonLd"
export { publicImageUrl, publicImagePath } from "./runtime/publicImageUrl"
export { howToStepAnchor } from "./runtime/howToStepAnchor"
export { readingTimeMinutes } from "./runtime/readingTime"
export { cn } from "./runtime/cn"

/** The running FlowCMS version, so a theme can branch on it if it must. */
export { FLOWCMS_VERSION } from "./version"
