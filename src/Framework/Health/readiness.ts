import { handle } from "@/db/client"
import { getActiveStorageConfig } from "@/Framework/Storage/activeStorage"
import { StorageConfigurationError } from "@/Framework/Storage/StorageErrors"
import type { StorageDriverName } from "@/Framework/Storage/StorageDriver"

/**
 * Liveness and readiness are different questions, and this module answers the
 * harder one.
 *
 * Phase 3 established that FlowCMS can bind its port and then serve nothing but
 * 500s: an invalid FLOWCMS_ADMIN_PATH fails the instrumentation hook without
 * stopping the process. A TCP check calls that healthy. So the container's
 * health definition is an HTTP request to a route that actually inspects the
 * things a request needs.
 */

/** Database states. `migrations_pending` is distinct from `unavailable`
 *  because the two have different operator actions. */
export type DatabaseStatus = "ok" | "unavailable" | "migrations_pending"

/**
 * Storage states. Reported for operators; never gates readiness.
 *
 * `misconfigured` is distinct from `not_configured` because the operator's next
 * action differs. "Not configured" means nothing has been set — the normal
 * state of a fresh install whose owner has not opened Settings yet.
 * "Misconfigured" means something WAS set and is wrong: an unknown
 * `STORAGE_DRIVER`, or `STORAGE_DRIVER=local` with no `LOCAL_STORAGE_PATH`.
 * Collapsing the two would tell an operator who made a typo that they had
 * simply not started.
 */
export type StorageStatus =
  | "connected"
  | "not_configured"
  | "misconfigured"
  | "connection_failed"

/**
 * What `checkStorage` reports: a state, plus which backend it is about.
 *
 * THE DRIVER IS NOT PUT ON THE WIRE. `/api/ready` is unauthenticated
 * infrastructure and its payload is pinned to an exact field list by three
 * tests, precisely so that a field cannot be added casually. Knowing whether an
 * instance stores files on a filesystem or in an object store is useful to an
 * operator and is also a fact about the deployment that an anonymous caller has
 * no need for, so it stays available to authenticated surfaces — the setup
 * screen and Admin > Settings > Storage — and off the public probe.
 */
export interface StorageReadiness {
  status: StorageStatus
  /** Null when `STORAGE_DRIVER` names something that is not a driver. */
  driver: StorageDriverName | null
}

/**
 * CMS initialization state. Reported for operators; never gates readiness.
 *
 * A STATE VOCABULARY RATHER THAN A BOOLEAN, matching `database` and `storage`
 * in the same payload — and because `unknown` is a real answer. With the
 * database unreachable, "setupComplete: false" would be a guess that an
 * orchestrator dashboard renders as "fresh install" in the middle of an outage.
 */
export type SetupReadiness = "complete" | "incomplete" | "unknown"

/**
 * Login CAPTCHA configuration. Reported AND gating — see the note in
 * `buildReadinessReport` for why this one is different from storage.
 */
export type CaptchaReadiness = "usable" | "missing" | "unsafe" | "unknown"

/**
 * Session-signing secret configuration. Reported AND gating, like the captcha
 * secret and for the same reason — but kept as a SEPARATE component, never
 * merged into one "secrets" status. The two fail in opposite directions (a bad
 * captcha secret closes login for everyone; a bad auth secret opens it for
 * forgers), and an operator needs to know which variable to set.
 */
export type AuthReadiness = "usable" | "missing" | "unsafe" | "unknown"

export interface ReadinessReport {
  status: "ready" | "not_ready"
  database: DatabaseStatus
  storage: StorageStatus
  setup: SetupReadiness
  captcha: CaptchaReadiness
  auth: AuthReadiness
  /** Not serialized to the client — the route uses it to pick the HTTP code. */
  httpStatus: 200 | 503
}

/**
 * The readiness verdict, as a pure function of component states.
 *
 * Only the database gates. Storage does not, and neither do Search Console or
 * Bing. An instance with no bucket configured is a correct fresh install rather
 * than a broken one: the operator has started the container and not yet opened
 * Settings. Marking that unready would have an orchestrator restarting the
 * container while the human was configuring it — taking away the screen they
 * needed, for the crime of not having finished using it.
 *
 * Kept pure and separate from the probes below so the policy can be tested
 * exhaustively without a database.
 */
export function buildReadinessReport(checks: {
  database: DatabaseStatus
  storage: StorageStatus
  setup?: SetupReadiness
  captcha?: CaptchaReadiness
  auth?: AuthReadiness
}): ReadinessReport {
  /**
   * THREE THINGS GATE: the database, the login CAPTCHA's configuration, and
   * the session-signing secret.
   *
   * Adding the second one contradicts the storage rule above only in
   * appearance. The difference is where the fix lives:
   *
   *   STORAGE is DB-BACKED. An operator corrects it in Settings, inside the
   *   running container. Gating would have the orchestrator restart that
   *   container while they were typing — removing the screen they needed.
   *
   *   CAPTCHA_SECRET and AUTH_SECRET are ENV-ONLY. Neither can be corrected from a running
   *   container at all: the fix *is* a restart with the variable set. So gating
   *   takes nothing away from the operator, and it converts a failure they
   *   would otherwise meet at their first sign-in attempt — after first-run
   *   setup completed into an installation nobody can administer — into a
   *   container that never reports itself healthy in the first place.
   *
   * `unknown` does NOT gate. It is the default for callers that did not check,
   * and treating "I did not look" as "it is broken" would make every
   * unmigrated call site fail.
   */
  const captcha = checks.captcha ?? "unknown"
  const auth = checks.auth ?? "unknown"
  const blocked = (state: string) => state === "missing" || state === "unsafe"
  const ready = checks.database === "ok" && !blocked(captcha) && !blocked(auth)

  return {
    status: ready ? "ready" : "not_ready",
    database: checks.database,
    storage: checks.storage,
    captcha,
    auth,
    // Reported, never gating. "The application is operational" and "the CMS has
    // been initialized" are different questions, and an operator part-way
    // through first-run setup has a healthy container. Gating here would have
    // the orchestrator restart the container while they were using the very
    // page that fixes it — the same mistake the storage rule avoids, one layer
    // up.
    setup: checks.setup ?? "unknown",
    httpStatus: ready ? 200 : 503,
  }
}

/**
 * Reachability and schema presence in one query.
 *
 * Counting `__drizzle_migrations` proves both that the database file is
 * openable and that the migrator has run at least once. A reachable but
 * unmigrated database is exactly what a container has if the entrypoint's
 * migration step is skipped or fails, and it must not read as ready — every
 * request would 500 on a missing table while the probe said everything was
 * fine.
 */
export async function checkDatabase(): Promise<DatabaseStatus> {
  // Both questions go through the adapter, which answers them in whichever
  // dialect is configured. This used to issue `select count(*) from
  // __drizzle_migrations` directly, which is SQLite-shaped in a way that is
  // easy to miss: PostgreSQL's migrator puts that table in a separate `drizzle`
  // schema, so the query failed and a perfectly healthy PostgreSQL instance
  // reported itself unavailable — the probe was measuring its own assumption.
  try {
    await handle.ping()
  } catch {
    return "unavailable"
  }

  try {
    return (await handle.migrationsApplied()) ? "ok" : "migrations_pending"
  } catch {
    // Reachable but the bookkeeping table is absent: the entrypoint's migration
    // step was skipped or failed. Distinct from unavailable because the
    // operator's next action is different.
    return "migrations_pending"
  }
}

/**
 * Storage state, without a network round trip.
 *
 * Resolving the configuration is the whole check. `getActiveStorageConfig()` throws a
 * typed `StorageConfigurationError` when the driver is unknown, when a local
 * deployment has no root, or when an S3 deployment is missing a bucket or
 * credentials — which covers every "this cannot work" case reachable without
 * touching the backend.
 *
 * It is deliberately NOT followed by a HeadBucket or a directory stat: this
 * probe runs every fifteen seconds for the life of the container, and turning
 * it into steady authenticated traffic against the operator's object store — or
 * letting it stall on that store's timeout — costs more than the freshness is
 * worth. `connection_failed` therefore exists in the vocabulary but is never
 * returned here; it is what a deliberate connection test reports, where a human
 * is waiting for the answer and the round trip is the point.
 *
 * REPORTS THE ACTIVE DRIVER, NOT S3. This used to call `getS3Config()`
 * unconditionally, so a perfectly healthy Local deployment — which has no S3
 * credentials by design — reported `not_configured` forever, and a Local
 * deployment with a broken root reported `connected` because the S3 settings
 * happened to be present.
 *
 * AND NOT THE ENVIRONMENT. `getActiveStorageConfig()` reads the DURABLE
 * snapshot; the environment answers only while an installation has not pinned
 * one. That distinction is the whole point after Phase 4: an installation that
 * has migrated from S3 to Local still has `STORAGE_DRIVER=s3` in its .env, and
 * a probe that read the environment would report a healthy site as
 * misconfigured — or, worse, report S3 as connected while every file lives on a
 * filesystem. `storageActiveTopology.test.ts` pins this across a migration.
 */
export async function checkStorage(): Promise<StorageReadiness> {
  try {
    const config = await getActiveStorageConfig()
    return { status: "connected", driver: config.driver }
  } catch (error) {
    if (error instanceof StorageConfigurationError) {
      // NOT A CONFIGURATION PROBLEM AT ALL. `active_topology_unavailable` means
      // a completed installation could not record or confirm WHICH location it
      // uses — the configuration may be perfect and the database unreachable.
      // Reporting it as `misconfigured` would send an operator to edit settings
      // during a database outage, and claiming a driver would be inventing one:
      // not knowing where the files are is precisely the state being reported.
      if (error.problem === "active_topology_unavailable") {
        return { status: "connection_failed", driver: null }
      }

      // "Nothing is set up yet" versus "what is set up is wrong". A fresh
      // install sits in the first state legitimately; the second is a typo.
      //
      // `classifyStorageFailure` in Setup/prerequisites.ts maps the SAME problem
      // codes onto its own vocabulary in exactly this shape. The two surfaces
      // must never describe one deployment differently, and
      // `storageStatusParity.test.ts` fails if they diverge.
      const status: StorageStatus =
        error.problem === "s3_incomplete" ? "not_configured" : "misconfigured"
      const driver: StorageDriverName | null =
        error.problem === "driver_invalid"
          ? null
          : error.problem === "s3_incomplete"
            ? "s3"
            : "local"
      return { status, driver }
    }
    // Not a configuration problem — the settings row could not be read at all.
    // Reported as a backend failure rather than as missing configuration.
    return { status: "connection_failed", driver: null }
  }
}
