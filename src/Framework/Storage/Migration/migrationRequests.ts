import { z } from "zod"
import {
  ENTRY_CLASSIFICATIONS,
  ENTRY_STATES,
  MIGRATION_MODES,
} from "./migrationState"

/**
 * WHAT THE MIGRATION API ACCEPTS, AND WHAT IT REFUSES.
 *
 * Kept apart from `migrationApi.ts` deliberately. That module holds the
 * authentication gate, which reaches Auth.js and therefore the whole Next.js
 * server runtime; these are pure schemas. Splitting them means the rules about
 * what a request may contain can be exhausted in a plain unit test, without
 * standing up an auth stack to ask whether a filesystem path is accepted.
 *
 * THE RULE WITH TEETH: a local destination carries nothing but its name. Its
 * path is deployment configuration, and a root a request could name would make
 * an admin session a write primitive anywhere the process can reach.
 */

/**
 * A LOCAL DESTINATION CARRIES NOTHING BUT ITS NAME.
 *
 * `.strict()` is the point of this branch. Phase 4c DISCARDED a submitted root,
 * which is safe but silent: a client sending `{ driver: "local", root: "/etc" }`
 * got a 201 and a migration to somewhere else entirely, and had no way to tell
 * that the field it sent had been ignored rather than honoured. Refusing it
 * outright is the difference between "we handled that" and "we noticed".
 *
 * The path itself comes from `LOCAL_STORAGE_PATH` and only from there. A root a
 * request could name would make an admin session a write primitive anywhere the
 * process can reach.
 */
const localDestinationSchema = z
  .object({ driver: z.literal("local") })
  .strict()

/** Strict too, so a stray `root` on an S3 destination is refused just as loudly. */
const s3DestinationSchema = z
  .object({
    driver: z.literal("s3"),
    endpoint: z.string().trim().max(2048).optional(),
    region: z.string().trim().max(255).optional(),
    bucket: z.string().trim().max(255).optional(),
    accessKeyId: z.string().trim().max(512).optional(),
    secretAccessKey: z.string().max(2048).optional(),
  })
  .strict()

export const createMigrationSchema = z
  .object({
    // THE DOMAIN’S OWN LIST, not a second copy of it. Three literal arrays
    // here duplicated three `as const` tuples in `migrationState.ts`, so
    // adding a state meant remembering to widen a Zod enum in another file —
    // and forgetting would silently reject a value the state machine considers
    // legal.
    mode: z.enum(MIGRATION_MODES, {
      message:
        'Choose "copy" for FlowCMS to migrate the files, or "verify" if you have already migrated ' +
        "them yourself.",
    }),
    destination: z.discriminatedUnion("driver", [localDestinationSchema, s3DestinationSchema]),
  })
  .strict()

export const acknowledgeSchema = z.object({
  acknowledgeExtras: z.literal(true),
  migrationId: z.string().uuid(),
  version: z.number().int().min(0),
})

export const cancelSchema = z.object({
  migrationId: z.string().uuid(),
  version: z.number().int().min(0),
  reason: z.string().trim().max(500).optional(),
})

export const batchSchema = z.object({
  migrationId: z.string().uuid(),
  /** Capped again in the service; a client cannot ask for unbounded work. */
  batchSize: z.number().int().min(1).max(500).optional(),
  concurrency: z.number().int().min(1).max(8).optional(),
})

export const advanceSchema = batchSchema.extend({
  action: z.enum(["transfer", "retry"]).default("transfer"),
})

export const cutoverSchema = z.object({
  migrationId: z.string().uuid(),
  version: z.number().int().min(0),
  /**
   * The deliberate final confirmation.
   *
   * A separate required field rather than "you called the endpoint, so you must
   * have meant it". This is the request that makes the destination
   * authoritative and cannot be undone, and a retried or replayed POST that
   * happened to reach it should not be one keystroke away from doing so.
   */
  confirm: z.literal(true, {
    message: "The cutover has to be confirmed explicitly.",
  }),
})

export const entriesQuerySchema = z.object({
  migrationId: z.string().uuid(),
  classification: z.enum(ENTRY_CLASSIFICATIONS).optional(),
  state: z.enum(ENTRY_STATES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})

