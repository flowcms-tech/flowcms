import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"

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
  /**
   * OPTIMISTIC CONCURRENCY.
   *
   * Every transition writes `version = version + 1` guarded by the version it
   * read. Two requests advancing the same job — an operator double-clicking, or
   * two replicas polling the same batch — cannot both win: the second matches
   * no row and is told the job moved underneath it. Without this, two callers
   * could each read `ready`, each decide to start, and both begin working.
   */
  version: integer("version").notNull().default(0),

  /** Entries discovered by inventory. Null until the source scan finishes. */
  totalEntries: integer("totalEntries"),
  copiedEntries: integer("copiedEntries").notNull().default(0),
  verifiedEntries: integer("verifiedEntries").notNull().default(0),
  /** Keys the destination filesystem cannot represent. Non-zero blocks. */
  incompatibleEntries: integer("incompatibleEntries").notNull().default(0),
  /** Same key, different content, already at the destination. Blocks. */
  conflictingEntries: integer("conflictingEntries").notNull().default(0),
  /** Present at the destination and not at the source. Never deleted; reported. */
  extraEntries: integer("extraEntries").notNull().default(0),
  /** At the source, not yet at the destination. Copy mode: work to do.
   *  Verify-only mode: a blocking failure of the operator's claim. */
  missingEntries: integer("missingEntries").notNull().default(0),
  /** Present on both sides with identical content. */
  matchingEntries: integer("matchingEntries").notNull().default(0),

  /**
   * Resumable scan positions — the last key enumerated on each side.
   *
   * TWO CURSORS, NOT ONE. The checkpoint had a single `inventoryCursor`, which
   * cannot express a job that finished scanning the source and is halfway
   * through the destination. Resuming such a job would have restarted one of
   * the two scans from the beginning.
   *
   * Cursors rather than page numbers: both backends enumerate by key, and a
   * numeric offset would silently skip or repeat entries when the store changes
   * between batches.
   *
   * `null` cursor with a `null` completedAt means "not started"; a set cursor
   * means "in progress"; a set completedAt means "done" — so a resumed job can
   * tell those three apart, which one nullable column cannot.
   */
  sourceCursor: text("sourceCursor"),
  sourceScanCompletedAt: integer("sourceScanCompletedAt", { mode: "timestamp_ms" }),
  destinationCursor: text("destinationCursor"),
  destinationScanCompletedAt: integer("destinationScanCompletedAt", { mode: "timestamp_ms" }),

  /**
   * Whether the destination filesystem distinguishes `A.png` from `a.png`.
   *
   * PROBED ONCE AND RECORDED, rather than derived from `process.platform`.
   * A Linux container can mount a case-insensitive volume and macOS is
   * case-insensitive by default, so the platform is a guess where the
   * filesystem is a fact. Recorded on the job so that a restart part-way
   * through inventory cannot reinterpret keys already classified under the
   * other assumption.
   *
   * Null for S3 destinations, where keys are case-sensitive byte strings.
   */
  destinationCaseSensitive: integer("destinationCaseSensitive", { mode: "boolean" }),

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

    /**
     * WHAT THE BASELINE COMPARISON FOUND. See `storageMigrationEntry.ts`.
     *
     * SEPARATE FROM `state`, and the checkpoint conflated them. One column
     * cannot say "this entry is missing at the destination AND has now been
     * copied" — classification describes the comparison, state describes
     * progress against it, and Phase 4b needs both at once.
     *
     * `missing` | `matching` | `conflicting` | `destination_only` | `incompatible`
     */
    classification: text("classification").notNull(),

    /**
     * PROGRESS AGAINST THAT CLASSIFICATION.
     *
     * `pending` | `hashed` | `copied` | `verified` | `blocked` | `failed` |
     * `source_deleted`
     */
    state: text("state").notNull(),

    sourceSize: integer("sourceSize"),
    /**
     * Baseline modification time, for Phase 4b's delta detection.
     *
     * A CHEAP PRE-FILTER, NEVER THE DECISION. An object whose mtime moved is
     * worth re-hashing; an object whose mtime did not move is NOT thereby
     * proven unchanged — clocks skew, and S3 sets its own timestamps. The hash
     * decides; this only narrows what has to be re-read.
     */
    sourceLastModified: integer("sourceLastModified", { mode: "timestamp_ms" }),
    /**
     * The provider's ETag, recorded and never trusted.
     *
     * INFORMATIONAL ONLY. A multipart upload's ETag is a hash of part hashes,
     * so it depends on the part size the uploader chose; server-side encryption
     * changes it again. Two identical objects can therefore carry different
     * ETags, and two different objects the same one. It is kept because it is
     * free and useful in a support conversation, and it is never the integrity
     * decision — `sourceHash` is.
     */
    sourceETag: text("sourceETag"),
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
    // "The next batch of work for this job."
    index("storage_migration_entry_job_state_idx").on(table.migrationId, table.state),
    /**
     * UNIQUE, which the checkpoint's plain index was not.
     *
     * Inventory must be idempotent: a resumed or retried scan re-enumerates
     * keys it has already recorded, and without uniqueness each retry inserted
     * a duplicate row — inflating every count and giving the copy phase the
     * same object twice. Uniqueness turns a retry into an upsert instead.
     */
    uniqueIndex("storage_migration_entry_job_key_idx").on(table.migrationId, table.key),
  ],
)

/** Terminal states — a job in one of these is no longer doing anything. */
export const STORAGE_MIGRATION_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const
