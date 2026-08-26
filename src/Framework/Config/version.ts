/**
 * Moved to `@/Themes/contract/version` in Phase 7.2. A theme reads
 * `FLOWCMS_VERSION` through the contract and core evaluates every theme's
 * `flowcmsCompat` against it, so the two must be the same constant — and the
 * package has to carry it.
 */
export { FLOWCMS_VERSION } from "@/Themes/contract/version"
