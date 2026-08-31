import { S3StorageDriver } from "./drivers/S3StorageDriver"
import { createLocalStorageDriver } from "./drivers/LocalStorageDriver"
import { getActiveStorageConfig } from "./activeStorage"
import type { StorageDriver } from "./StorageDriver"

/**
 * Which backend serves this request.
 *
 * THE ONLY PLACE A DRIVER IS CHOSEN. Nothing else in FlowCMS branches on
 * storage: not a File Manager route, not the media route, not the setup probe.
 * They all call `StorageService`, which calls this, which returns whichever
 * driver the deployment configured — and that is exactly why the whole File
 * Manager works unmodified on a filesystem.
 *
 * RESOLVED PER CALL, NEVER MEMOISED AT MODULE SCOPE. Configuration is read
 * fresh so that a cutover takes effect on the very next request rather than the
 * next restart — a memoised driver would keep serving the old location after
 * the migration said otherwise.
 *
 * IT RESOLVES THE ACTIVE TOPOLOGY, NOT THE ENVIRONMENT. `getActiveStorageConfig`
 * reads the persisted snapshot; the environment only answers while an
 * installation has not pinned one yet. That is what stops an edited
 * `STORAGE_DRIVER` from silently repointing a live site at an empty location.
 */

/**
 * Local drivers, one per root.
 *
 * The S3 driver is a stateless singleton — it resolves its configuration inside
 * every method — but a local driver is defined by its root, and building one is
 * not free: it creates the directory and resolves its real path, which it then
 * caches for containment checks. Constructing a fresh driver per request would
 * redo that `mkdir` and `realpath` on every thumbnail.
 *
 * Keyed BY ROOT rather than held as a single instance, so a configuration
 * change still produces a different driver. The map cannot grow meaningfully:
 * its size is the number of distinct roots a process has ever been configured
 * with, which is one.
 */
const localDrivers = new Map<string, StorageDriver>()

function localDriverFor(root: string): StorageDriver {
  const existing = localDrivers.get(root)
  if (existing) return existing

  const driver = createLocalStorageDriver(root)
  localDrivers.set(root, driver)
  return driver
}

export async function resolveStorageDriver(): Promise<StorageDriver> {
  const config = await getActiveStorageConfig()

  // GARAGE IS NOT A CASE HERE, and never will be. A bundled-Garage deployment
  // is `driver: "s3"` pointed at `http://garage:3900`; the driver cannot tell
  // it apart from AWS or R2, which is what lets an operator move between them
  // by editing environment variables.
  return config.driver === "local" ? localDriverFor(config.root) : S3StorageDriver
}
