import { eq, type SQL } from "drizzle-orm"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"
import { db, databaseDialect } from "./client"

/**
 * Write operations that behave identically on all four engines.
 *
 * WHY THESE EXIST
 *
 * `.returning()` is supported by SQLite and PostgreSQL and not by MySQL or
 * MariaDB. `onConflictDoUpdate` is SQLite/PostgreSQL syntax; MySQL spells it
 * `ON DUPLICATE KEY UPDATE`. Both are reachable from the canonical SQLite type
 * the application compiles against, so calls to them compile and then fail at
 * runtime on MySQL only — the worst possible failure shape, invisible until a
 * user picks a different database.
 *
 * So they are forbidden outside `src/db/` (enforced by
 * `tests/architecture/dialectIsolation.test.ts`) and replaced by these.
 *
 * WHY THE MYSQL FALLBACK IS SAFE, NOT A RACE
 *
 * §17 of the Phase 5 brief rightly forbids emulating RETURNING with
 * "insert, then find the newest row" — `ORDER BY id DESC LIMIT 1` is a race
 * that corrupts data under concurrency.
 *
 * Nothing here does that. FlowCMS generates every primary key in application
 * code (`crypto.randomUUID()` — there is no autoincrement anywhere in the 24
 * tables), so the caller already knows the key before the write happens. The
 * read-back selects by that exact key. Two concurrent inserts cannot confuse
 * each other because neither is guessing which row it made.
 */

/**
 * Tables are generic so the helpers return the table's OWN inferred row type.
 * Returning  would have moved the type erosion this
 * architecture exists to avoid out of the application and into here, which is
 * not an improvement — it just hides it one layer down.
 */
type Row<T extends SQLiteTable> = T["$inferSelect"]
type Insertable<T extends SQLiteTable> = T["$inferInsert"]

function usesReturning(dialect: typeof databaseDialect = databaseDialect): boolean {
  // MariaDB's MySQL-compatible mode does not implement RETURNING for the
  // statements Drizzle's mysql2 driver emits, so it is grouped with MySQL.
  return dialect === "sqlite" || dialect === "postgresql"
}

/**
 * Insert one row and return it.
 *
 * The id is materialised HERE rather than left to the schema's
 * `$defaultFn(() => crypto.randomUUID())`, and that detail is the whole reason
 * this is safe on MySQL. A default function runs inside Drizzle during the
 * insert, so the caller never learns the value — which would leave the MySQL
 * read-back with nothing to select by, and only "find the newest row" as an
 * option. That is precisely the race this helper exists to avoid. Generating
 * the key one line earlier turns an unanswerable question into a lookup.
 *
 * `where` is optional and only needed for the composite-key tables, which have
 * no single id column to derive a predicate from.
 */
export async function insertReturning<T extends SQLiteTable>(
  table: T,
  values: Insertable<T>,
  where?: SQL,
): Promise<Row<T>> {
  const columns = table as unknown as Record<string, unknown>
  const hasIdColumn = "id" in columns
  // `Insertable<T>` has no statically-known `id` — some tables key on composite
  // columns instead — so this one read is widened. It never leaves the function.
  const supplied = values as Record<string, unknown>

  const row: Record<string, unknown> =
    hasIdColumn && supplied.id === undefined
      ? { id: crypto.randomUUID(), ...supplied }
      : { ...supplied }

  const predicate =
    where ??
    (hasIdColumn
      ? eq(columns.id as never, row.id as never)
      : (() => {
          throw new Error(
            "insertReturning: this table has no `id` column, so the row cannot be " +
              "identified after the write. Pass an explicit `where` predicate.",
          )
        })())

  if (usesReturning()) {
    const [inserted] = await db
      .insert(table)
      .values(row as never)
      .returning()
    return inserted as Row<T>
  }

  // MySQL family: write, then read back by the key we just generated. Wrapped
  // in a transaction so nothing can modify the row between the two statements.
  return db.transaction(async (tx) => {
    await tx.insert(table).values(row as never)
    const [inserted] = await tx.select().from(table).where(predicate).limit(1)
    if (!inserted) {
      throw new Error(
        "insertReturning: the inserted row was not found by its own key.",
      )
    }
    return inserted as Row<T>
  })
}

/**
 * Update rows and return the first affected one.
 *
 * Every call site in FlowCMS updates by primary key, so the read-back is
 * deterministic for the same reason `insertReturning` is.
 */
export async function updateReturning<T extends SQLiteTable>(
  table: T,
  values: Partial<Insertable<T>>,
  where: SQL,
): Promise<Row<T>> {
  const row = await updateReturningMaybe(table, values, where)
  if (!row) {
    // Every call site checks the row exists (usually returning 404) before
    // updating, so reaching here means the row vanished between the check and
    // the write. The previous `const [x] = …returning()` shape produced
    // `undefined` and crashed a few lines later on a property access; naming
    // the cause is strictly better than that, and the failure mode is the same.
    throw new Error("updateReturning: the update matched no rows")
  }
  return row
}

/** As `updateReturning`, but tolerates matching nothing. */
export async function updateReturningMaybe<T extends SQLiteTable>(
  table: T,
  values: Partial<Insertable<T>>,
  where: SQL,
): Promise<Row<T> | undefined> {
  if (usesReturning()) {
    const [row] = await db
      .update(table)
      .set(values as never)
      .where(where)
      .returning()
    return row as Row<T> | undefined
  }

  return db.transaction(async (tx) => {
    await tx
      .update(table)
      .set(values as never)
      .where(where)
    const [row] = await tx.select().from(table).where(where).limit(1)
    return row as Row<T> | undefined
  })
}

/** Delete rows, returning those that existed beforehand. */
export async function deleteReturning<T extends SQLiteTable>(
  table: T,
  where: SQL,
): Promise<Row<T>[]> {
  if (usesReturning()) {
    const rows = await db.delete(table).where(where).returning()
    return rows as Row<T>[]
  }

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(table).where(where)
    await tx.delete(table).where(where)
    return rows as Row<T>[]
  })
}

/**
 * Insert, or update the row that conflicts.
 *
 * `target` names the conflicting column(s) for SQLite/PostgreSQL. MySQL does
 * not take a target — it reacts to whichever unique key was violated — which is
 * a real semantic difference: on MySQL a conflict on a *different* unique index
 * also updates. Every current call site conflicts on the primary key or on a
 * single unique column, where the two behave identically.
 */
export async function upsert<T extends SQLiteTable>(
  table: T,
  values: Insertable<T>,
  options: {
    target: unknown
    set: Record<string, unknown>
    /**
     * The handle to write through. Defaults to the application's.
     *
     * Injectable so a caller holding a DIFFERENT handle — a repository built
     * over a temporary database in a test, say — still gets the dialect
     * branching from here rather than reimplementing it. The alternative was to
     * let such callers write their own `onConflictDoUpdate`, which
     * `dialectIsolation.test.ts` forbids precisely because that syntax is
     * SQLite/PostgreSQL only and fails on MySQL and MariaDB.
     */
    executor?: Pick<typeof db, "insert">
    /**
     * Which dialect that executor speaks.
     *
     * REQUIRED WHENEVER `executor` IS. The branch below is the whole reason
     * this helper exists, and it used to read the APPLICATION's dialect even
     * when handed somebody else's handle — so an injected MySQL executor was
     * given `onConflictDoUpdate`, which the MySQL builder does not have, and
     * the promise in the note above ("still gets the dialect branching from
     * here") was not kept. Defaults to the application's, which is correct for
     * every caller that does not inject one.
     */
    dialect?: typeof databaseDialect
  },
): Promise<void> {
  const executor = options.executor ?? db

  if (usesReturning(options.dialect ?? databaseDialect)) {
    await executor
      .insert(table)
      .values(values as never)
      .onConflictDoUpdate({ target: options.target as never, set: options.set as never })
    return
  }

  // The canonical type has no onDuplicateKeyUpdate, so this reaches for the
  // MySQL builder explicitly. Confined to this file by design.
  const insert = executor.insert(table).values(values as never) as unknown as {
    onDuplicateKeyUpdate: (config: { set: Record<string, unknown> }) => Promise<unknown>
  }
  await insert.onDuplicateKeyUpdate({ set: options.set })
}

/**
 * How many rows a write actually touched — normalised across the three drivers.
 *
 * WHY THIS EXISTS
 *
 * A conditional claim is the only portable way to let exactly one of several
 * concurrent writers win:
 *
 *   UPDATE settings SET setupCompletedAt = ? WHERE id = 'global' AND setupCompletedAt IS NULL
 *
 * A second writer blocks on the row lock, then re-evaluates its own WHERE
 * clause against the committed row and matches nothing. Reading the row first
 * and then updating it unconditionally would be a lost update under
 * PostgreSQL's READ COMMITTED — both attempts would see null and both would
 * write.
 *
 * So the claim's verdict IS the affected-row count, and that count is reported
 * three different ways by the three drivers, none of them visible on the
 * canonical SQLite type the application compiles against:
 *
 *   libsql      ResultSet.rowsAffected
 *   postgres.js RowList.count            (an array carrying a `count` property)
 *   mysql2      [ResultSetHeader, FieldPacket[]] -> header.affectedRows
 *
 * FAILS CLOSED. An unrecognised shape returns 0, which reads as "I did not
 * win". That direction is deliberate: a false loser aborts a setup attempt and
 * the operator retries, while a false winner creates a second owner of the
 * installation. If a driver upgrade changes the shape, first-run setup breaks
 * loudly rather than duplicating ownership quietly.
 *
 * `affectedRows` is preferred over MySQL's `changedRows`, which excludes rows
 * whose new values equalled the old ones — a claim that wrote an identical
 * timestamp would report zero and be misread as a loss.
 */
export function affectedRowCount(result: unknown): number {
  if (result === null || result === undefined) return 0

  // mysql2: [ResultSetHeader, FieldPacket[]]. Checked before the object branch
  // because an array is also an object.
  if (Array.isArray(result)) {
    // postgres.js RowList is an array with a `count` property.
    const count = (result as unknown as { count?: unknown }).count
    if (typeof count === "number") return count

    const header = result[0] as { affectedRows?: unknown } | undefined
    if (header && typeof header.affectedRows === "number") return header.affectedRows

    // A plain array of returned rows is data, not a count. Reading `length`
    // here would report a win for any UPDATE ... RETURNING that matched.
    return 0
  }

  if (typeof result === "object") {
    const shape = result as { rowsAffected?: unknown; affectedRows?: unknown; count?: unknown }
    if (typeof shape.rowsAffected === "number") return shape.rowsAffected
    if (typeof shape.affectedRows === "number") return shape.affectedRows
    if (typeof shape.count === "number") return shape.count
  }

  return 0
}

/**
 * Did a write lose a race on a unique constraint?
 *
 * WALKS THE `cause` CHAIN, and that is not defensive padding — it is the whole
 * function. Drizzle wraps driver errors: on PostgreSQL the thrown error's own
 * message is `Failed query: insert into "settings" (…column list…)`, which
 * contains no hint of a constraint at all, while the actual
 * `duplicate key value violates unique constraint "settings_pkey"` sits one
 * level down in `cause`. Matching only the top-level message works on
 * SQLite/libsql — where the driver error is thrown directly — and silently
 * fails on the other three engines.
 *
 * Caught on PostgreSQL by the Phase 7.1 four-engine matrix: the concurrent-setup
 * race rethrew instead of returning `already_completed`, so the losing operator
 * would have seen a 500 rather than "setup has already been completed".
 *
 * SQLSTATE and driver codes are checked first because they are exact. The text
 * match stays as a fallback for drivers that report neither.
 */
export function isUniqueViolation(error: unknown): boolean {
  const CODES = new Set([
    "23505", // PostgreSQL unique_violation
    "ER_DUP_ENTRY", // MySQL / MariaDB
    "1062", // MySQL / MariaDB, numeric
    "SQLITE_CONSTRAINT_PRIMARYKEY",
    "SQLITE_CONSTRAINT_UNIQUE",
    "SQLITE_CONSTRAINT",
  ])
  const TEXT = /unique|duplicate|constraint failed/i

  // Bounded: a cycle in `cause` must not hang a request handler.
  let current: unknown = error
  for (let depth = 0; current && depth < 8; depth += 1) {
    const shape = current as { message?: unknown; code?: unknown; cause?: unknown }
    if (shape.code !== undefined && CODES.has(String(shape.code))) return true
    if (typeof shape.message === "string" && TEXT.test(shape.message)) return true
    current = shape.cause
  }
  return false
}
