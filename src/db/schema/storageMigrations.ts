import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

/**
 * MOVING AN INSTALLATION'S FILES FROM ONE BACKEND TO ANOTHER.
 *
 * Durable because it has to be. A store can hold more objects than one HTTP
 * request can copy, the process can restart mid-copy, and an operator will
 * close the tab. A migration held in memory would resume as "some unknown
 * fraction of the files are at the destination", which is the one state this
 * whole design exists to prevent.
 *
 * So every decision the migration makes is written down before it acts on it,
 * and the source stays authoritative until a single transactional cutover says
 * otherwise. An interrupted migration is always recoverable by reading these
 * two tables: the source is still live, the destination holds a partial copy
 * that nothing points at, and the job knows exactly which objects it created.
 */

/** One relocation attempt. At most one may be open at a time. */
export const storageMigrations = sqliteTable("storage_migration", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

  /**
   * Where the job is in its lifecycle.
   *
   * Ordered, explicit, and never inferred from counters — a job that has copied
   * every object is not thereby "ready", because verification is a separate
   * claim from transfer. See `storageMigrationState.ts` for the legal
   * transitions and the reasoning behind each terminal state.
   */
  status: text("status").notNull(),

  /**
   * `copy`   FlowCMS transfers the files itself.
   * `verify` the operator says they already did; FlowCMS only checks.
   *
   * The distinction is honoured absolutely: a `verify` job never writes a
   * single source object to the destination, including during final
   * reconciliation. The operator made a claim and the job's entire purpose is
   * to test it, not to quietly paper over the parts that were wrong.
   */
  mode: text("mode").notNull(),

  // -- Source: the topology that is live right now --------------------------
  sourceDriver: text("sourceDriver").notNull(),
  sourceLocationId: text("sourceLocationId").notNull(),
  sourceEndpoint: text("sourceEndpoint"),
  sourceRegion: text("sourceRegion"),
  sourceBucket: text("sourceBucket"),
  sourceRoot: text("sourceRoot"),

  // -- Destination: a candidate, never active until cutover -----------------
  destinationDriver: text("destinationDriver").notNull(),
  destinationLocationId: text("destinationLocationId").notNull(),
  destinationEndpoint: text("destinationEndpoint"),
  destinationRegion: text("destinationRegion"),
  destinationBucket: text("destinationBucket"),
  destinationRoot: text("destinationRoot"),
  /** Destination credentials. Never returned by any API, exactly as
   *  `s3SecretAccessKey` is never returned. */
  destinationAccessKeyId: text("destinationAccessKeyId"),
  destinationSecretAccessKey: text("destinationSecretAccessKey"),

  // -- Progress -------------------------------------------------------------
  /** Entries discovered by inventory. Null until inventory finishes. */
  totalEntries: integer("totalEntries"),
  copiedEntries: integer("copiedEntries").notNull().default(0),
  verifiedEntries: integer("verifiedEntries").notNull().default(0),
  /** Keys the destination filesystem cannot represent. Non-zero blocks. */
  incompatibleEntries: integer("incompatibleEntries").notNull().default(0),
  /** Same key, different content, already at the destination. Blocks. */
  conflictingEntries: integer("conflictingEntries").notNull().default(0),
  /** Present at the destination and not at the source. Never deleted; reported. */
  extraEntries: integer("extraEntries").notNull().default(0),

  /**
   * Resumable inventory position — the last key enumerated.
   *
   * A cursor rather than a page number: object stores paginate by key, and a
   * numeric offset would silently skip or repeat entries when the store changes
   * between batches.
   */
  inventoryCursor: text("inventoryCursor"),

  /** Operator acknowledgement that destination-only objects will become
   *  visible in the File Manager after cutover. Required to leave `ready`. */
  extrasAcknowledged: integer("extrasAcknowledged", { mode: "boolean" }).notNull().default(false),

  /** Redacted operator-facing failure text. Never contains a credential. */
  failureReason: text("failureReason"),

  /** When the baseline pass finished — the boundary the final delta is against. */
  baselineCompletedAt: integer("baselineCompletedAt", { mode: "timestamp_ms" }),
  cutoverAt: integer("cutoverAt", { mode: "timestamp_ms" }),

  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * One source entry, and what happened to it.
 *
 * PER-ENTRY ROWS RATHER THAN A COUNTER, and the reason is reconciliation. When
 * the final delta runs, the job has to answer a question a counter cannot:
 * "did I create this destination object, or was it already there?" Deleting a
 * pre-existing destination object that merely shares a key with a since-deleted
 * source object would destroy data the migration never owned.
 *
 * It also makes retries idempotent and progress real: a resumed job skips
 * entries already marked verified rather than re-transferring the store.
 */
export const storageMigrationEntries = sqliteTable(
  "storage_migration_entry",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    migrationId: text("migrationId")
      .notNull()
      .references(() => storageMigrations.id, { onDelete: "cascade" }),

    /** The object key, byte-identical on both sides. Never rewritten. */
    key: text("key").notNull(),
    /** `file`, or `directory` for an empty folder — an S3 zero-byte marker on
     *  one side and a real directory on the other. */
    kind: text("kind").notNull(),

    /** `pending`, `copied`, `verified`, `matching`, `conflict`, `incompatible`,
     *  `failed`, `source_deleted`. */
    state: text("state").notNull(),

    sourceSize: integer("sourceSize"),
    /** SHA-256 of the source bytes. NOT an ETag: a multipart upload's ETag is a
     *  hash of part hashes, and server-side encryption changes it again, so two
     *  identical objects can carry different ETags and two different objects
     *  the same one. */
    sourceHash: text("sourceHash"),
    destinationSize: integer("destinationSize"),
    destinationHash: text("destinationHash"),

    /**
     * Whether THIS migration wrote the destination object.
     *
     * The whole reason per-entry rows exist. Only an entry created by this job
     * may be removed during final reconciliation; anything that was already at
     * the destination is untouchable.
     */
    createdByMigration: integer("createdByMigration", { mode: "boolean" })
      .notNull()
      .default(false),

    /** Why an entry is incompatible or conflicting, for the operator's report. */
    detail: text("detail"),
    attempts: integer("attempts").notNull().default(0),

    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // The two access patterns: "next batch of pending work for this job" and
    // "the row for this exact key".
    index("storage_migration_entry_job_state_idx").on(table.migrationId, table.state),
    index("storage_migration_entry_job_key_idx").on(table.migrationId, table.key),
  ],
)

/** Terminal states — a job in one of these is no longer doing anything. */
export const STORAGE_MIGRATION_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const
