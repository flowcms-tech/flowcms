/**
 * Theme constants with no dependencies.
 *
 * Deliberately dependency-free, exactly like `Framework/Auth/permissions.ts`
 * and `Framework/Activity/activityTypes.ts`, and for the same reason: this
 * value is needed by the admin view model, which is rendered in the browser.
 * Importing it from `registry.ts` would evaluate the registry — and therefore
 * every installed theme's components — into the client bundle, to read one
 * string.
 */

/** The theme that must always exist: the fallback when the selected theme is
 *  missing, unavailable, or does not implement a surface. */
export const DEFAULT_THEME_SLUG = "default"

/**
 * The value that gets persisted when an operator activates `slug`.
 *
 * Selecting the default theme stores NULL rather than the literal "default",
 * so "no explicit choice" keeps one representation — see the column comment in
 * `src/db/schema/settings.ts`. Normalising here rather than in the route means
 * the admin screen and the activation endpoint agree about what a click will
 * do, which is what makes the no-op check below trustworthy.
 */
export function normalizeThemeSelection(slug: string): string | null {
  return slug === DEFAULT_THEME_SLUG ? null : slug
}

/**
 * Whether activating `slug` would change anything.
 *
 * Compares the value that *would* be persisted against the value that already
 * is. This is the one rule; the Appearance screen uses it to decide whether to
 * offer an Activate button and the API uses it to decide whether to write and
 * whether to log — so the button and the endpoint can never disagree.
 *
 * Note what it does NOT compare: which theme is *rendering*. During a fallback
 * the default theme is rendering while the stored intent points somewhere else,
 * and activating the default is a real change — it clears the stale selection
 * and the warning with it.
 */
export function isNoOpActivation(slug: string, requestedSlug: string | null): boolean {
  return normalizeThemeSelection(slug) === requestedSlug
}
