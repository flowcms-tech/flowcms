import { sql, type Column, type SQL } from "drizzle-orm"

/**
 * Safe `LIKE` matching against caller-supplied text.
 *
 * THE PROBLEM
 *
 * Interpolating a value into a `LIKE` pattern is not the same as parameterising
 * it. The value is bound safely — this was never SQL injection — but `%` and
 * `_` remain *wildcards inside the pattern*, so the value still changes which
 * rows match.
 *
 * That is a real authorization bug in the public image route. It asks "is any
 * published post's content referencing this key?" by matching
 * `%/api/public/images/<key>%`. Request the key `%` and the pattern collapses to
 * "any post whose content mentions the image route at all" — so one published
 * post with one image makes every private object in the bucket readable by
 * anyone. Same for `_`, one character at a time.
 *
 * THE FIX, AND WHY IT IS ESCAPING RATHER THAN REJECTION
 *
 * Underscores are ordinary in filenames (`my_photo.png`), so refusing keys
 * containing `_` would break real images. Escaping keeps every legitimate key
 * working and makes the wildcard characters mean themselves.
 *
 * `ESCAPE` is standard SQL and behaves identically on SQLite, PostgreSQL,
 * MySQL and MariaDB, so this survives the planned multi-database work. The
 * escape character is a backslash written as a code point: a literal backslash
 * inside a SQL string literal is the kind of thing that quietly acquires or
 * loses a level of quoting as it moves between drivers and dialects.
 */

export const LIKE_ESCAPE_CHAR = String.fromCharCode(0x5c)

/**
 * Escapes `LIKE` metacharacters in a literal value.
 *
 * The escape character must be doubled FIRST — doing it last would also escape
 * the backslashes this function just introduced for `%` and `_`, turning
 * `a%b` into a pattern that matches a literal backslash.
 */
export function escapeLikePattern(value: string): string {
  return value
    .split(LIKE_ESCAPE_CHAR)
    .join(LIKE_ESCAPE_CHAR + LIKE_ESCAPE_CHAR)
    .split("%")
    .join(LIKE_ESCAPE_CHAR + "%")
    .split("_")
    .join(LIKE_ESCAPE_CHAR + "_")
}

/**
 * `column LIKE '%<value>%' ESCAPE '\'` with `value` treated as literal text.
 *
 * Use this instead of Drizzle's `like(column, `%${value}%`)` anywhere `value`
 * comes from outside the process. Drizzle's own `like()` has no way to attach
 * an `ESCAPE` clause, which is why this drops to a `sql` fragment.
 */
export function likeContains(column: Column, value: string): SQL {
  const pattern = `%${escapeLikePattern(value)}%`
  return sql`${column} LIKE ${pattern} ESCAPE ${LIKE_ESCAPE_CHAR}`
}

/**
 * `column LIKE '<value>%' ESCAPE '\x27` with `value` treated as literal text.
 *
 * The anchored sibling of `likeContains`. Anchoring matters where the answer is
 * a containment question rather than a search one: "is anything stored UNDER
 * this path" must not also match a path that merely mentions it in the middle,
 * and on an ordered index a leading-anchored pattern is a range scan rather
 * than a full one.
 */
export function likeStartsWith(column: Column, value: string): SQL {
  const pattern = `${escapeLikePattern(value)}%`
  return sql`${column} LIKE ${pattern} ESCAPE ${LIKE_ESCAPE_CHAR}`
}
