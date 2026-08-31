/**
 * The shapes the storage-migration API returns.
 *
 * Mirrors `Framework/Storage/Migration/migrationDto.ts` deliberately rather
 * than importing it: these are the fields the browser is allowed to see, and
 * writing them out here means a field added to the server DTO does not silently
 * become part of the client's world. Note what is absent — there is no field a
 * credential could arrive in.
 */

export interface LocationDescription {
  driver: "s3" | "local"
  /** Local only. Deployment configuration, shown read-only. */
  root?: string
  /** S3 only, already redacted: `https://***@host`. */
  endpoint?: string
  region?: string
  bucket?: string
  label: string
}

export interface MigrationProgress {
  total: number
  verified: number
  pending: number
  failed: number
  blocked: number
  sourceChanged: number
  sourceDeleted: number
  ambiguous: number
}

export interface MigrationJob {
  id: string
  status: MigrationStatus
  mode: "copy" | "verify"
  version: number

  source: LocationDescription
  destination: LocationDescription
  /** Whether a secret is stored. Never the secret. */
  destinationHasCredentials: boolean

  destinationTested: boolean
  inventory: {
    destinationScanComplete: boolean
    sourceScanComplete: boolean
    recorded: number
  }

  counts: {
    byClassification: Record<string, number>
    byState: Record<string, number>
  }
  progress: MigrationProgress

  readiness: { ready: boolean; reasons: string[] }
  extras: { count: number; acknowledged: boolean; acknowledgementStale: boolean }

  cutoverAllowed: boolean
  cutoverBlockedBy: string[]

  lock: { held: boolean; startedAt: string | null; stale: boolean }

  failureReason: string | null
  createdAt: string
  updatedAt: string
  cutoverAt: string | null
}

export type MigrationStatus =
  | "draft"
  | "destination_tested"
  | "inventorying"
  | "blocked"
  | "ready"
  | "copying"
  | "verifying"
  | "ready_to_cutover"
  | "cutting_over"
  | "completed"
  | "failed"
  | "cancelled"

export interface RecoveryReport {
  outcome:
    | "idle"
    | "interrupted_before_commit"
    | "committed_needs_finalising"
    | "unexpected_topology"
  migrationId: string | null
  actions: string[]
  message: string | null
  severity: "none" | "info" | "critical"
}

export interface MigrationSnapshot {
  active: LocationDescription | null
  drift: { message: string; candidate: LocationDescription } | null
  localDestination: { available: boolean; root?: string; reason?: string }
  job: MigrationJob | null
  recovery: RecoveryReport | null
  /** The relocation that most recently finished. Null before the first one. */
  lastCompleted: {
    source: LocationDescription
    destination: LocationDescription
    mode: string
    cutoverAt: string | null
  } | null
}

export interface MigrationEntry {
  key: string
  kind: string
  classification: string
  state: string
  sourceSize: number | null
  destinationSize: number | null
  detail: string | null
  attempts: number
}

export interface MigrationEntryPage {
  entries: MigrationEntry[]
  total: number
  limit: number
  offset: number
}

export interface DestinationTestOutcome {
  ok: boolean
  failure?: string
  message?: string
  job: MigrationJob | null
}

export type CutoverOutcome =
  | { outcome: "completed"; migrationId: string; reconciliation: Record<string, number> }
  | { outcome: "refused"; refusal: string; reasons: string[] }
  | { outcome: "aborted"; refusal: string; reasons: string[] }
  | { outcome: "needs_recovery"; reasons: string[] }

/** What the destination form collects. The Local case collects nothing. */
export interface DestinationDraft {
  driver: "s3" | "local"
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}
