import { getSettingsRow, getS3Config } from "@/Framework/Settings/SettingsService"
import { pinActiveStorage } from "./activeStorageStore"
import { StorageConfigurationError } from "./StorageErrors"
import {
  getEnvironmentStorageConfig,
  storageLocationId,
  type ResolvedStorageConfig,
} from "./storageConfig"
import type { StorageDriverName } from "./StorageDriver"

/**
 * WHERE THIS INSTALLATION'S FILES ACTUALLY LIVE.
 *
 * THE ENVIRONMENT BOOTSTRAPS AN INSTALLATION; A PERSISTED SNAPSHOT OWNS IT.
 *
 * Phase 3 resolved the active backend from `STORAGE_DRIVER` on every request.
 * That is right for choosing a backend at install time and dangerous
 * afterwards: editing one variable and restarting silently repointed a live
 * site at a different, empty location. Every stored key stayed valid, nothing
 * was copied, nothing warned, and every image was gone.
 *
 * So once an installation is real — `setupCompletedAt` is set — whatever it is
 * using is written down, and from then on the snapshot answers the question.
 * The environment becomes a CANDIDATE rather than a command, and moving
 * between locations is a migration with a verified cutover.
 *
 * WHY SETUP COMPLETION IS THE PINNING MOMENT. Earlier would be wrong: an
 * operator part-way through installation is still choosing, and a container
 * that booted on the default bundled-Garage configuration would pin that the
 * moment it started — making their first real S3 edit look like a relocation
 * and refusing it. Later would leave the invariant unenforced for exactly the
 * installations that have data to lose.
 *
 * WHAT THE SNAPSHOT DOES NOT OWN: credentials. They stay in the settings row
 * and the environment, so rotating a key is still an ordinary edit. That
 * separation is the whole reason `storageLocationId()` can tell a rotation from
 * a relocation.
 */

/** The settings columns that make up the snapshot. */
interface ActiveTopologyRow {
  setupCompletedAt?: Date | null
  activeStorageDriver?: string | null
  activeStorageEndpoint?: string | null
  activeStorageRegion?: string | null
  activeStorageBucket?: string | null
  activeStorageRoot?: string | null
  s3AccessKeyId?: string | null
  s3SecretAccessKey?: string | null
}

function isPinned(row: ActiveTopologyRow | null): boolean {
  return Boolean(row?.activeStorageDriver)
}

/**
 * Rebuilds the active configuration from the snapshot.
 *
 * Location comes from the snapshot; credentials come from the settings row,
 * falling back to the environment exactly as they always have.
 */
async function fromSnapshot(row: ActiveTopologyRow): Promise<ResolvedStorageConfig> {
  const driver = row.activeStorageDriver as StorageDriverName

  if (driver === "local") {
    return { driver: "local", root: row.activeStorageRoot ?? "" }
  }

  // Credentials are resolved through the existing path so that a rotation —
  // settings row over environment, per field — keeps working untouched.
  const credentials = await getS3Config().catch(() => null)

  return {
    driver: "s3",
    endpoint: row.activeStorageEndpoint ?? undefined,
    region: row.activeStorageRegion ?? undefined,
    bucket: row.activeStorageBucket ?? "",
    accessKeyId: row.s3AccessKeyId || credentials?.accessKeyId || "",
    secretAccessKey: row.s3SecretAccessKey || credentials?.secretAccessKey || "",
  }
}

/**
 * The active storage configuration — the one `StorageService` uses.
 *
 * Reads the settings row on every call rather than caching, matching the
 * per-operation resolution every other layer follows. The row itself is already
 * cached by `SettingsService`, so this is not a database read per request.
 */
export async function getActiveStorageConfig(): Promise<ResolvedStorageConfig> {
  const row = (await getSettingsRow()) as ActiveTopologyRow | null

  if (isPinned(row)) return fromSnapshot(row!)

  // Nothing pinned: the environment is authoritative. This is a fresh install,
  // an installation still being set up, or a legacy one upgrading — and in
  // every one of those cases the environment IS what it is using.
  const config = await getEnvironmentStorageConfig()

  if (!row?.setupCompletedAt) {
    // Still being installed. The environment IS what this deployment is using,
    // and an operator part-way through setup is still choosing — pinning here
    // would refuse their first real configuration edit as a relocation.
    return config
  }

  // The installation is real and is using this. RECORD IT, DURABLY.
  //
  // NOT BEST-EFFORT, and the Phase 4 checkpoint had that wrong. Swallowing a
  // failed pin quietly reopens the exact hole the snapshot exists to close: a
  // completed installation whose write keeps failing would run indefinitely on
  // mutable environment topology while believing itself protected, and an
  // environment edit during that window would relocate it silently.
  try {
    await pinActiveStorage(config)
  } catch (error) {
    throw new StorageConfigurationError(
      "active_topology_unavailable",
      "FlowCMS could not record which storage location is in use, so it will not serve storage " +
        "until it can. This is usually a database problem; it resolves itself once the database " +
        "is reachable.",
      { cause: error },
    )
  }

  // RE-READ, because the pin is a conditional UPDATE and may have matched
  // nothing: two requests arriving together on a freshly-completed
  // installation both see no snapshot, and only one of them writes. The loser
  // must adopt what was actually persisted rather than carry on with what it
  // resolved from the environment — otherwise the two requests would disagree
  // about where files live for the rest of their lifetimes.
  const pinned = (await getSettingsRow()) as ActiveTopologyRow | null
  if (isPinned(pinned)) return fromSnapshot(pinned!)

  // The write reported success and the row still has no snapshot. Something is
  // wrong that guessing cannot fix, so this refuses rather than falling back to
  // the environment.
  throw new StorageConfigurationError(
    "active_topology_unavailable",
    "FlowCMS could not confirm which storage location is in use.",
  )
}

/**
 * How the deployment's environment differs from what is actually active.
 *
 * REPORTED, NEVER APPLIED. This exists so the admin panel can tell an operator
 * "you changed configuration and it did not take effect, here is why" instead
 * of leaving them to wonder. Acting on it is what the migration workflow is
 * for.
 *
 * Credentials are not drift — a rotation is not a move — so this compares
 * location identity only. The message never quotes either configuration: an
 * endpoint can carry credentials in its userinfo.
 */
export function describeTopologyDrift(
  active: ResolvedStorageConfig,
  candidate: ResolvedStorageConfig,
): string | null {
  if (storageLocationId(active) === storageLocationId(candidate)) return null

  const what =
    active.driver !== candidate.driver
      ? `from ${active.driver} to ${candidate.driver}`
      : "to a different location"

  return (
    `This deployment's storage configuration has been changed ${what}, but the change has NOT ` +
    `been applied: the files are still where they were. Applying it means migrating them, which ` +
    `is a guided process — test the destination, copy or verify, then cut over.`
  )
}
