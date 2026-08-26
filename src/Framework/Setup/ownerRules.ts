/**
 * The first-owner and site-identity bounds, in one dependency-free module.
 *
 * DEPENDENCY-FREE ON PURPOSE, exactly like `Framework/Auth/permissions.ts` and
 * `Framework/Activity/activityTypes.ts`. These constants are needed by three
 * things that cannot all import each other:
 *
 *   completeSetup.ts               server, imports the database client
 *   Modules/Setup/Values/…         a Zod schema shared with a 'use client' form
 *   tests/setup/bootstrapParity    the parity check against the CLI script
 *
 * They started out on `completeSetup.ts`, and that was a real defect rather than
 * an untidiness: the client form's schema imported them, which dragged
 * `@/db/client` into the browser bundle, which dragged in `postgres`, `mysql2`
 * and `@libsql/client`, which fail to resolve `net`, `dns` and `fs` and break
 * `next build` outright. The build caught it; nothing else would have.
 *
 * Values only. No Zod, no database, no `server-only`, nothing that pulls a
 * runtime behind it.
 */

/** Matches `MIN_PASSWORD_LENGTH` in scripts/bootstrap-owner.mjs, pinned by a test. */
export const MIN_OWNER_PASSWORD_LENGTH = 12

/**
 * bcrypt silently truncates past 72 bytes, so a longer value would create a
 * password whose tail does nothing — and this endpoint is unauthenticated, so
 * unbounded input is unbounded work.
 */
export const MAX_OWNER_PASSWORD_LENGTH = 72

/** Matches the length bound in scripts/bootstrap-owner.mjs, pinned by a test. */
export const MAX_OWNER_EMAIL_LENGTH = 100

export const MAX_OWNER_NAME_LENGTH = 100
export const MAX_SITE_NAME_LENGTH = 100
export const MAX_TAGLINE_LENGTH = 200

/** Shape only. Identity normalisation lives in `Framework/Auth/identity.ts`. */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
