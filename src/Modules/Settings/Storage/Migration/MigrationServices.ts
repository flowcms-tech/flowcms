import BAPI from "@/Framework/API_Layer"
import type {
  CutoverOutcome,
  DestinationDraft,
  DestinationTestOutcome,
  MigrationEntryPage,
  MigrationJob,
  MigrationSnapshot,
} from "./MigrationTypes"

/**
 * The client half of the storage-migration API.
 *
 * Every call is one bounded step. NOTHING HERE LOOPS: the batch endpoints
 * return after a fixed amount of work and the component decides whether to ask
 * again, because a browser that drove the whole migration in one request would
 * be a migration that a closed laptop lid abandons. The server's database is
 * the position; this is a remote control for it.
 */

interface ApiResponse<T> {
  data: T
  message: string | string[]
}

const BASE = "/api/settings/storage/migration"

/** Batch calls are noisy by nature; a toast per batch would be unusable. */
const QUIET = { showGlobalError: false, showGlobalSuccess: false } as const

export const MigrationServices = {
  async snapshot(): Promise<MigrationSnapshot> {
    const res = await BAPI.get<ApiResponse<MigrationSnapshot>>(BASE, QUIET)
    return res.data
  },

  async create(mode: "copy" | "verify", destination: DestinationDraft): Promise<MigrationJob> {
    const res = await BAPI.post<ApiResponse<MigrationJob>>(
      BASE,
      {
        mode,
        // The Local case sends the DRIVER AND NOTHING ELSE. The path comes from
        // the deployment's own configuration; a request cannot name one, and
        // the server discards the field even if one is sent.
        destination:
          destination.driver === "local"
            ? { driver: "local" }
            : {
                driver: "s3",
                endpoint: destination.endpoint,
                region: destination.region,
                bucket: destination.bucket,
                accessKeyId: destination.accessKeyId,
                secretAccessKey: destination.secretAccessKey,
              },
      },
      { showGlobalError: false, showGlobalSuccess: true, keepEmptyStrings: true },
    )
    return res.data
  },

  async testDestination(migrationId: string): Promise<DestinationTestOutcome> {
    const res = await BAPI.post<ApiResponse<DestinationTestOutcome>>(
      `${BASE}/destination-test`,
      { migrationId },
      QUIET,
    )
    return res.data
  },

  async inventoryBatch(migrationId: string, batchSize = 100) {
    const res = await BAPI.post<ApiResponse<{ complete: boolean; scanned: number; job: MigrationJob | null }>>(
      `${BASE}/inventory`,
      { migrationId, batchSize },
      QUIET,
    )
    return res.data
  },

  async advanceBatch(migrationId: string, batchSize = 25) {
    const res = await BAPI.post<ApiResponse<{ exhausted: boolean; claimed: number; job: MigrationJob | null }>>(
      `${BASE}/advance`,
      { migrationId, action: "transfer", batchSize },
      QUIET,
    )
    return res.data
  },

  async retryFailed(migrationId: string) {
    const res = await BAPI.post<ApiResponse<{ retried: number; job: MigrationJob | null }>>(
      `${BASE}/advance`,
      { migrationId, action: "retry" },
      { showGlobalError: false, showGlobalSuccess: true },
    )
    return res.data
  },

  async entries(
    migrationId: string,
    filter: { classification?: string; state?: string } = {},
    page: { limit?: number; offset?: number } = {},
  ): Promise<MigrationEntryPage> {
    const params = new URLSearchParams({ migrationId })
    if (filter.classification) params.set("classification", filter.classification)
    if (filter.state) params.set("state", filter.state)
    params.set("limit", String(page.limit ?? 25))
    params.set("offset", String(page.offset ?? 0))

    const res = await BAPI.get<ApiResponse<MigrationEntryPage>>(
      `${BASE}/entries?${params.toString()}`,
      QUIET,
    )
    return res.data
  },

  async acknowledgeExtras(migrationId: string, version: number) {
    const res = await BAPI.patch<ApiResponse<{ acknowledged: number; job: MigrationJob | null }>>(
      BASE,
      { acknowledgeExtras: true, migrationId, version },
      { showGlobalError: false, showGlobalSuccess: true },
    )
    return res.data
  },

  async cancel(migrationId: string, version: number) {
    const res = await BAPI.delete<ApiResponse<{ cancelled: boolean; destinationRetained: number }>>(
      BASE,
      { migrationId, version },
      { showGlobalError: false, showGlobalSuccess: true },
    )
    return res.data
  },

  /**
   * The irreversible step.
   *
   * `confirm: true` is a required field on the server, not a client convention:
   * this is the request that makes the destination authoritative, and a
   * replayed or retried POST should not be one keystroke away from doing so.
   */
  async cutover(migrationId: string, version: number): Promise<CutoverOutcome> {
    const res = await BAPI.post<ApiResponse<CutoverOutcome>>(
      `${BASE}/cutover`,
      { migrationId, version, confirm: true },
      { showGlobalError: false, showGlobalSuccess: false },
    )
    return res.data
  },
}
