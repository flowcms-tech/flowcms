import { randomUUID } from "node:crypto"
import { checkDatabase } from "@/Framework/Health/readiness"
import { StorageService } from "@/Framework/Storage/StorageService"
import { getCaptchaConfig } from "@/Framework/Captcha/captchaConfig"
import { getAuthSecretConfig } from "@/Framework/Auth/authSecretConfig"

/**
 * What a deployment must actually be able to do before its installation may be
 * marked initialized.
 *
 * The states are the vocabulary the browser sees, and they are states rather
 * than messages on purpose: this page is unauthenticated and reachable by
 * anyone who can find a fresh install, so it must never carry a hostname, a
 * bucket name, an endpoint, a credential, a connection string or exception
 * text. Detail goes to the server log, redacted, where the operator can read
 * it.
 */

export type DatabasePrerequisite = "ready" | "migrations_pending" | "unavailable"
export type StoragePrerequisite = "ready" | "not_configured" | "unavailable"
/**
 * Login CAPTCHA configuration (Phase 7.1.1).
 *
 * `CAPTCHA_SECRET` is deployment configuration and is deliberately NOT asked
 * for on the setup form. It appears here for the same reason database and
 * storage do: it is something the deployment must be able to do before its
 * installation may be called initialized.
 */
export type CaptchaPrerequisite = "ready" | "missing" | "unsafe"
/**
 * Session-signing secret configuration (Phase 7.1.2). Also deployment
 * configuration, also never asked for on the setup form, and kept as its own
 * component rather than merged with the captcha one — the operator needs to
 * know which variable to set.
 */
export type AuthPrerequisite = "ready" | "missing" | "unsafe"

export interface Prerequisites {
  database: DatabasePrerequisite
  storage: StoragePrerequisite
  captcha: CaptchaPrerequisite
  auth: AuthPrerequisite
  /** True only when every REQUIRED prerequisite is satisfied. */
  satisfied: boolean
}

/**
 * The prefix the storage probe writes under.
 *
 * Namespaced and dot-prefixed so it sorts away from operator content, and
 * deleted immediately — a first-run check must not leave an artefact behind in
 * somebody's bucket, and must not create anything the File Manager would list
 * as if a human had put it there.
 */
export const SETUP_PROBE_PREFIX = ".flowcms-setup-check/"

/**
 * Prove storage works by using it, through FlowCMS's own abstraction.
 *
 * Round-trip rather than a HeadBucket, because "the bucket exists" is not the
 * claim that matters. FlowCMS has no local filesystem media backend: every
 * image in every post is written, read and removed through `StorageService`,
 * and a credential with list-but-not-write permission would pass a bucket check
 * and fail every upload the operator makes afterwards. This exercises the exact
 * path the File Manager uses, which is the same reasoning
 * `docker/storage-roundtrip.test.ts` was built on.
 *
 * Presigning is not exercised because it no longer exists: Phase 2 removed it
 * from the storage contract entirely. The check is the smallest thing that
 * proves the claim.
 *
 * The object is deleted and the delete is verified. A probe that leaves litter
 * in a production bucket every time an operator reloads the setup page is a
 * defect, not a diagnostic.
 */
export async function checkStoragePrerequisite(): Promise<StoragePrerequisite> {
  const key = `${SETUP_PROBE_PREFIX}${randomUUID()}.txt`
  const body = Buffer.from("flowcms setup check\n", "utf8")

  try {
    await StorageService.uploadObject(key, body, "text/plain")
  } catch (error) {
    // Both "no credentials configured" and "credentials rejected" surface here.
    // They are reported as one state because the operator's next action is the
    // same — open the deployment's storage configuration — and distinguishing
    // them would mean telling an anonymous caller which one it was.
    logProbeFailure("storage upload", error)
    return isStorageUnconfigured(error) ? "not_configured" : "unavailable"
  }

  try {
    const readBack = await StorageService.downloadObject(key)
    if (Buffer.from(readBack).toString("utf8") !== body.toString("utf8")) {
      logProbeFailure("storage read-back", new Error("content did not match what was written"))
      return "unavailable"
    }
  } catch (error) {
    logProbeFailure("storage read-back", error)
    return "unavailable"
  } finally {
    // Always attempt cleanup, including on a failed read-back — the object was
    // written, so leaving it behind would be litter either way.
    await StorageService.deleteObject(key).catch((error) => {
      logProbeFailure("storage cleanup", error)
    })
  }

  return "ready"
}

/** Distinguishes "nothing is configured" from "what is configured does not work". */
function isStorageUnconfigured(error: unknown): boolean {
  // `getS3Config()` throws this exact shape when bucket or credentials are
  // absent from both the settings row and the environment.
  return error instanceof Error && error.message.includes("S3 is not configured")
}

/**
 * Server-side only, and redacted by construction: the message is logged, never
 * the configuration. Nothing here reaches the browser.
 */
function logProbeFailure(what: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  console.warn(`[flowcms:setup] ${what} check failed: ${detail}`)
}

/**
 * The completion gate, as a pure function of component states.
 *
 * DATABASE, STORAGE, THE LOGIN CAPTCHA'S CONFIGURATION AND THE SESSION-SIGNING
 * SECRET ARE ALL REQUIRED. Redis is not checked at all.
 *
 * Storage is required because FlowCMS has no local media backend. Marking an
 * installation complete while its only supported media backend is unusable
 * hands the operator an admin panel where the File Manager, the editor's image
 * picker and every upload fail, with nothing having warned them — and it does
 * so at the exact moment they would have been able to fix the configuration
 * easily.
 *
 * This is deliberately a stricter rule than `/api/ready`, which storage does
 * not gate. The two answer different questions: a container must be able to
 * serve the very page that tells an operator their storage is broken.
 */
export function buildPrerequisites(checks: {
  database: DatabasePrerequisite
  storage: StoragePrerequisite
  captcha?: CaptchaPrerequisite
  auth?: AuthPrerequisite
}): Prerequisites {
  /**
   * CAPTCHA CONFIGURATION IS A PREREQUISITE (Phase 7.1.1).
   *
   * Setup may complete only on a deployment that will actually let the operator
   * log in afterwards. Without a usable `CAPTCHA_SECRET`, no login challenge
   * can be issued or verified, so nobody can sign in — and because completion
   * closes first-run setup PERMANENTLY, the operator would be left with an
   * initialized site they can never administer and no supported way to reopen
   * the form. That is the single worst state this product can reach, and it is
   * one boolean away.
   *
   * AUTH_SECRET IS A PREREQUISITE TOO (Phase 7.1.2), and the failure it prevents
   * is worse-shaped. A weak session-signing secret does not stop the owner
   * signing in — it lets anyone who can read the value forge a session as them.
   * Completing setup in that state produces an installation that looks correct,
   * has a permanently closed setup form, and is owned by whoever wants it.
   *
   * Both default to blocking. A caller that forgot to check must not thereby be
   * allowed through — the point of the check is that it cannot be skipped.
   */
  const captcha = checks.captcha ?? "missing"
  const auth = checks.auth ?? "missing"
  return {
    database: checks.database,
    storage: checks.storage,
    captcha,
    auth,
    satisfied:
      checks.database === "ready" &&
      checks.storage === "ready" &&
      captcha === "ready" &&
      auth === "ready",
  }
}

/** The live environment's captcha configuration, in this module's vocabulary. */
export function checkCaptchaPrerequisite(): CaptchaPrerequisite {
  const verdict = getCaptchaConfig()
  return verdict.state === "usable" ? "ready" : verdict.state
}

/** The live environment's session-signing configuration, same vocabulary. */
export function checkAuthPrerequisite(): AuthPrerequisite {
  const verdict = getAuthSecretConfig()
  return verdict.state === "usable" ? "ready" : verdict.state
}

/** Map the readiness probe's vocabulary onto this one. */
export async function checkDatabasePrerequisite(): Promise<DatabasePrerequisite> {
  const state = await checkDatabase()
  if (state === "ok") return "ready"
  return state === "migrations_pending" ? "migrations_pending" : "unavailable"
}

/** Every probe, run together. */
export async function checkPrerequisites(): Promise<Prerequisites> {
  const [database, storage] = await Promise.all([
    checkDatabasePrerequisite(),
    checkStoragePrerequisite(),
  ])
  // Synchronous — it reads one environment variable — so it is not awaited
  // alongside the two that touch the network.
  return buildPrerequisites({
    database,
    storage,
    captcha: checkCaptchaPrerequisite(),
    auth: checkAuthPrerequisite(),
  })
}
