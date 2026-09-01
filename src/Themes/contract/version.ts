/**
 * The running FlowCMS version.
 *
 * Hardcoded, and deliberately not read from `package.json` at runtime. Next's
 * file tracer decides what reaches a standalone build, and a JSON file nothing
 * imports statically is exactly what it leaves behind — the failure class that
 * hit Phase 4 with the database drivers and Phase 5 with the migration SQL,
 * twice each. A theme-compatibility check that throws `ENOENT` in production
 * and works in development is worse than no check.
 *
 * It must be kept in step with `package.json`'s `version` field when FlowCMS is
 * released. `tests/themes/registry.test.ts` asserts the shipped default theme
 * declares a range this satisfies, so a bump that breaks the default theme
 * fails the suite rather than the website.
 */
export const FLOWCMS_VERSION = "0.2.0"
