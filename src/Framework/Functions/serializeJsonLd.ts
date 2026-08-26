/**
 * Moved to `@/Themes/contract/runtime/serializeJsonLd` in Phase 7.2, because
 * `JsonLd` is a public theme export and the published package must contain its
 * escaping rather than reach back into the application for it.
 *
 * Re-exported here so every existing call site is unchanged and there is still
 * exactly one escaper — a second, subtly different one is how the XSS this
 * function prevents comes back.
 */
export { serializeJsonLd } from "@/Themes/contract/runtime/serializeJsonLd"
