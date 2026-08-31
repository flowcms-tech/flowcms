import { db } from "@/db/client"
import { storageMigrations, storageMigrationEntries } from "@/db/tables"
import { invalidateSettingsCache } from "@/Framework/Settings/SettingsService"
import { probeDestinationCaseSensitivity } from "./compatibility"
import { clearMigrationCredentials, commitCutover } from "./cutover"
import { testDestination } from "./destinationTest"
import { createMigrationRepository } from "./migrationRepository"
import { createMigrationService, type MigrationService } from "./migrationService"
import { getActiveStorageConfig } from "../activeStorage"
import { getEnvironmentStorageConfig } from "../storageConfig"
import { createStorageDriverFor } from "../storageDriverFactory"
import { acquireCutoverLock } from "../storageWriteLock"

/**
 * The migration service, wired to the real application.
 *
 * `migrationService.ts` takes every dependency that touches the settings row,
 * the environment or an object store as a parameter, which is what makes the
 * orchestration testable against a temporary database and temporary stores.
 * This is the one place those parameters are filled in with the real things.
 *
 * Built once per process rather than per request: it holds no state — the
 * database does — and the repository it closes over is a set of functions.
 */

let cached: MigrationService | null = null

export function getMigrationService(): MigrationService {
  if (cached) return cached

  cached = createMigrationService({
    repository: createMigrationRepository({
      db,
      migrations: storageMigrations,
      entries: storageMigrationEntries,
    }),
    activeConfig: getActiveStorageConfig,
    // The ENVIRONMENT is a candidate, not a command. It is read only so the
    // admin panel can say "you changed this and it did not take effect", and a
    // deployment whose environment is invalid must not make the storage screen
    // — the one place that can explain it — fail to render.
    environmentConfig: async () => getEnvironmentStorageConfig().catch(() => null),
    createDriver: createStorageDriverFor,
    testDestination,
    probeCaseSensitivity: probeDestinationCaseSensitivity,
    acquireLock: acquireCutoverLock,
    commit: commitCutover,
    clearCredentials: clearMigrationCredentials,
    invalidateCaches: invalidateSettingsCache,
    env: process.env,
  })

  return cached
}
