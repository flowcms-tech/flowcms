import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { users } from "./users"
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES } from "@/Framework/Activity/activityTypes"

/**
 * Who changed what, and when. Append-only; nothing in the app ever updates a
 * row here.
 *
 * The design constraint that shapes every column below: **an entry has to stay
 * readable after its subject is gone.** The most valuable question this table
 * answers is "what happened to the post that isn't there any more", so it
 * cannot lean on foreign keys to the thing it describes — a cascade would
 * delete exactly the evidence someone came looking for.
 *
 * Hence: `entityId` is a plain string with no reference, and `entityLabel` is a
 * snapshot of the name at the time. A renamed category's old entries keep
 * saying the old name, which is correct — that *was* what it was called.
 */
export const activityLog = sqliteTable(
  "activity_log",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

    /** `set null` rather than `restrict`: deleting a staff account must not be
     *  blocked by their history, and must not delete it either. `actorName`
     *  below is what keeps the entry legible once this goes null. */
    actorId: text("actorId").references(() => users.id, { onDelete: "set null" }),
    /** Snapshot of the actor's name at the time of the action. Not a
     *  convenience denormalisation — it is the only thing that still names the
     *  person after their account is deleted. */
    actorName: text("actorName").notNull(),

    action: text("action", { enum: ACTIVITY_ACTIONS }).notNull(),
    entityType: text("entityType", { enum: ACTIVITY_ENTITY_TYPES }).notNull(),

    /** No foreign key, deliberately — see the note above. Null once the entity
     *  never had an id of its own (site settings) or the write failed to
     *  produce one. */
    entityId: text("entityId"),
    /** Title, name, or path at the time of the action. */
    entityLabel: text("entityLabel").notNull(),

    /** One human sentence: which fields changed, or why. The list screen shows
     *  this verbatim, so it is written for a person, not parsed by anything. */
    summary: text("summary"),

    /** Optional JSON for detail the sentence can't carry (changed field names,
     *  before/after values). Nothing queries inside it. */
    metadata: text("metadata"),

    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // The default view is "everything, newest first", and pruning deletes by
    // age — both are this index.
    index("activity_log_createdAt_idx").on(t.createdAt),
    // "Show me this post's history" — the entity filter.
    index("activity_log_entity_idx").on(t.entityType, t.entityId),
    index("activity_log_actor_idx").on(t.actorId),
  ]
)

/**
 * How long entries are kept.
 *
 * There is no cron in this app, so pruning happens lazily when the log screen
 * is read (see `pruneExpiredActivity`) — the same pattern
 * `publishDueScheduledPosts` uses. That means the table can sit past its
 * retention while nobody looks at it, which is fine: the cap exists to bound
 * growth, not to guarantee deletion at a precise moment.
 */
export const ACTIVITY_RETENTION_DAYS = 90
