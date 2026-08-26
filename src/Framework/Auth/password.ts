import bcrypt from "bcryptjs"

/**
 * The bcrypt work factor, exported because it is now a CONTRACT rather than an
 * implementation detail.
 *
 * `scripts/bootstrap-owner.mjs` creates the first owner too, and it is plain
 * ESM that runs under `node` in the production image with no TypeScript loader
 * — so it cannot import this module and states the number itself. Two ways to
 * create the same account must not disagree about how its password is
 * protected, so `tests/setup/bootstrapParity.test.ts` reads both files and
 * fails when they drift.
 */
export const BCRYPT_COST = 12

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST)
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}
