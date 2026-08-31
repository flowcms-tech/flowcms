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
 * database.
 *
 * ONLY TWO WRITES IN FLOWCMS ESTABLISH OR MOVE A STORAGE LOCATION: the
 * first-run pin below, which is conditional on there being no snapshot yet and
 * therefore cannot relocate anything; and `commitCutover`, which replaces it
 * inside the one authoritative transaction. Both build their columns with
 * `activeStorageColumns` so there is a single definition of what the snapshot
 * IS. `storageRetentionInvariants.test.ts` fails if a third writer appears.
 */

/**
 * The snapshot columns, derived from a resolved configuration.
 *
 * EXPORTED so the cutover transaction uses these exact columns rather than a
 * second copy of them. There are only two writes in FlowCMS that establish or
 * move a storage location — the first-run pin below, and `commitCutover` — and
 * before this was shared they each spelled the same eight columns out
 * separately. Two spellings of "where the files are" is one edit away from an
 * installation whose snapshot and whose credentials disagree.
 *
 * `now` is a parameter because the cutover writes the settings row and the
 * migration job in one transaction and stamps both with a single instant.
 */
export function activeStorageColumns(config: ResolvedStorageConfig, now: Date = new Date()) {
  return {
    activeStorageDriver: config.driver,
    activeStorageLocationId: storageLocationId(config),
    activeStorageEndpoint: config.driver === "s3" ? (config.endpoint ?? null) : null,
    activeStorageRegion: config.driver === "s3" ? (config.region ?? null) : null,
    activeStorageBucket: config.driver === "s3" ? config.bucket : null,
    activeStorageRoot: config.driver === "local" ? config.root : null,
    activeStorageEstablishedAt: now,
    updatedAt: now,
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
    .set(activeStorageColumns(config))
    .where(and(eq(settings.id, SETTINGS_SINGLETON_ID), isNull(settings.activeStorageDriver)))

  await invalidateSettingsCache()
}
