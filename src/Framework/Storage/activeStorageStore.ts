import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db/client"
import { settings } from "@/db/tables"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { invalidateSettingsCache } from "@/Framework/Settings/SettingsService"
import { storageLocationId, type ResolvedStorageConfig } from "./storageConfig"

/**
 * Writing the active-storage snapshot.
 *
 * Split from `activeStorage.ts` so the resolution logic can be tested without a
 * database, and so the two writes below — the first pin, and a cutover — are
 * the only places in FlowCMS that can change where files live.
 */

/** The snapshot columns, derived from a resolved configuration. */
function columnsFor(config: ResolvedStorageConfig) {
  return {
    activeStorageDriver: config.driver,
    activeStorageLocationId: storageLocationId(config),
    activeStorageEndpoint: config.driver === "s3" ? (config.endpoint ?? null) : null,
    activeStorageRegion: config.driver === "s3" ? (config.region ?? null) : null,
    activeStorageBucket: config.driver === "s3" ? config.bucket : null,
    activeStorageRoot: config.driver === "local" ? config.root : null,
    activeStorageEstablishedAt: new Date(),
    updatedAt: new Date(),
  }
}

/**
 * Records what an installation is already using, once, without overwriting.
 *
 * A CONDITIONAL UPDATE, not a read-then-write. Two requests arriving together
 * on a freshly-completed installation would both see no snapshot and both
 * write one; `WHERE activeStorageDriver IS NULL` makes the second a no-op
 * instead of a second answer to "where do the files live". The same
 * conditional-claim shape first-run setup already uses for its marker.
 *
 * It can therefore never RELOCATE anything: an installation with a snapshot is
 * untouched by this function, whatever the environment now says.
 */
export async function pinActiveStorage(config: ResolvedStorageConfig): Promise<void> {
  await db
    .update(settings)
    .set(columnsFor(config))
    .where(and(eq(settings.id, SETTINGS_SINGLETON_ID), isNull(settings.activeStorageDriver)))

  await invalidateSettingsCache()
}

/**
 * Moves the active topology. THE ONLY FUNCTION IN FLOWCMS THAT DOES.
 *
 * Unconditional, unlike `pinActiveStorage`, because a cutover is precisely the
 * case where an existing snapshot must be replaced. It is exported separately
 * rather than as a flag on the same function so that the dangerous operation
 * has a name a reader cannot miss, and so `grep` finds every caller.
 *
 * Takes an optional transaction: the cutover writes this and the migration
 * job's terminal state together, so an installation can never be left pointing
 * at a destination its migration record does not know it reached.
 */
export async function commitActiveStorage(
  config: ResolvedStorageConfig,
  tx?: Pick<typeof db, "update">,
): Promise<void> {
  const executor = tx ?? db

  await executor
    .update(settings)
    .set(columnsFor(config))
    .where(eq(settings.id, SETTINGS_SINGLETON_ID))

  // Deliberately AFTER the write, and outside any transaction the caller may
  // still roll back: a cache cleared for a change that then did not happen is
  // one extra database read, while a cache left stale after a cutover serves
  // the old bucket until it expires.
  await invalidateSettingsCache()
}
