/**
 * Identity normalization for values whose sameness must not depend on the
 * database.
 *
 * MySQL and MariaDB default to case-insensitive collation; PostgreSQL and
 * SQLite compare case-sensitively. Leaving email identity to the database means
 * one FlowCMS install treats `User@example.com` and `user@example.com` as two
 * accounts and another treats them as one — and worse, the login lookup
 * (`eq(users.email, …)`) compares in code, case-sensitively, so on PostgreSQL a
 * user could sign up as `User@…`, type `user@…` at the login screen, and be
 * told their own account does not exist.
 *
 * So the product decides, and the database stores the decision. Collation
 * becomes a performance characteristic rather than a behavioural one, which is
 * the only way four engines can share one contract.
 *
 * SLUGS ARE DELIBERATELY NOT HERE
 *
 * Post, tag, category and author slugs — and custom page paths — are validated
 * against `slugPattern` / `pathPattern`, which permit lowercase only. Uppercase
 * never reaches the database because it is rejected at the boundary, which is a
 * stronger guarantee than normalising it: the operator is told their input was
 * invalid instead of quietly receiving a URL they did not type. Nothing needs
 * to be added for them, on any engine.
 */

/**
 * Canonical form of an email address for identity comparison.
 *
 * Case and surrounding whitespace only. Plus-addressing and dots in the local
 * part are left alone on purpose: some providers treat them as significant, and
 * collapsing them would merge addresses whose owners consider them distinct.
 * Validation of shape remains Zod's job — this answers "are these the same
 * address", not "is this an address".
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}
