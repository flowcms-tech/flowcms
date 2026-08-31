import { randomUUID } from "node:crypto"
import { checkDatabase } from "@/Framework/Health/readiness"
import { StorageService } from "@/Framework/Storage/StorageService"
import { StorageConfigurationError } from "@/Framework/Storage/StorageErrors"
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
/**
 * Storage states the setup page reports.
 *
 * `misconfigured` IS DISTINCT FROM `not_configured`, and Phase 4 made it so
 * after finding the two collapsed here while `/api/ready` already told them
 * apart — the same deployment could be described two different ways depending
 * on which surface you asked.
 *
 * The distinction is not cosmetic. The likeliest wrong value for
 * `STORAGE_DRIVER` is `garage`, because that IS one of the installer's storage
 * choices — it is infrastructure reached through the s3 driver, not a driver.
 * An operator who types it and is told "storage is not configured" goes and
 * checks their S3 credentials, which are perfectly fine, and has no way to
 * discover that the problem is one word in a different variable.
 *
 *   not_configured   nothing has been set. The normal state of a fresh install
 *                    whose owner has not configured storage yet.
 *   misconfigured    something WAS set and is wrong: an unknown driver name, or
 *                    a local driver with no path.
 *   unavailable      configuration is coherent, but the backend failed.
 *
 * All three still BLOCK completion. They are separate so the page can say which
 * one it is — a state name, never a value, because this page is unauthenticated.
 */
export type StoragePrerequisite =
  | "ready"
  | "not_configured"
  | "misconfigured"
  | "unavailable"
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
 * The key prefix the storage probe writes under.
 *
 * A FILENAME PREFIX, NOT A DIRECTORY, and the trailing character is the whole
 * point. This used to be `".flowcms-setup-check/"`, which on S3 is just a key
 * that happens to contain a slash — S3 has no directories, so deleting the
 * object left nothing behind.
 *
 * On a filesystem the same key creates a real directory. `deleteObject` unlinks
 * the file and the now-empty `.flowcms-setup-check/` folder stays, so every
 * Local installation ended up with a permanent phantom folder in its File
 * Manager, created by a check the operator never ran deliberately.
 *
 * The alternatives were worse. Hiding dot-prefixed entries from listings would
 * be a broad filter that also hides legitimate keys — an S3 bucket may hold a
 * real `.well-known/` — and pruning empty parent directories after a delete
 * would silently destroy folders an operator explicitly created. Cleaning up
 * with `deletePrefix` would race: two setup pages open at once, and one probe
 * deletes the other's object before it can be read back, reporting a working
 * backend as broken.
 *
 * Making the key contain no slash at all removes the artefact on every backend
 * with no filter, no pruning and no race. A probe that does leak now sorts to
 * the very top of the root listing, which is the right place for a bug to be
 * visible.
 */
export const SETUP_PROBE_PREFIX = ".flowcms-setup-check-"

/**
 * Prove storage works by using it, through FlowCMS's own abstraction.
 *
 * Round-trip rather than a HeadBucket, because "the bucket exists" is not the
 * claim that matters. Every image in every post is written, read and removed
 * through `StorageService`, and a credential with list-but-not-write permission
 * would pass a bucket check and fail every upload the operator makes
 * afterwards. This exercises the exact path the File Manager uses, which is the
 * same reasoning `docker/storage-roundtrip.test.ts` was built on.
 *
 * DRIVER-AGNOSTIC BY CONSTRUCTION. It goes through `StorageService`, which
 * dispatches to whichever driver the deployment configured, so it tests the
 * ACTIVE backend and only that one. A Local installation is proved by writing
 * and reading a real file under `LOCAL_STORAGE_PATH`; an S3 installation by
 * writing and reading a real object. Neither is asked about the other, which is
 * what lets a Local deployment complete setup with no S3 credentials at all.
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
    return classifyStorageFailure(error)
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

/**
 * Turns a storage failure into the state the setup page shows.
 *
 * A TYPE TEST, NOT A STRING MATCH. This used to read
 * `error.message.includes("S3 is not configured")`, which made a
 * human-readable sentence into program logic — and, worse, was true of every
 * correctly-configured Local deployment, because a Local install has no S3
 * credentials by design. It would have reported a working filesystem
 * installation as a broken S3 one and refused to let setup complete.
 *
 * The problem codes map exactly as `checkStorage` maps them, so the setup page
 * and `/api/ready` can never describe the same deployment differently.
 */
function classifyStorageFailure(error: unknown): StoragePrerequisite {
  if (!(error instanceof StorageConfigurationError)) return "unavailable"
  // Not a configuration fault: FlowCMS could not establish WHICH location is
  // active, which is a backend problem and not something the operator can fix
  // on the settings screen. Mirrors `checkStorage`, which reports the same case
  // as `connection_failed`.
  if (error.problem === "active_topology_unavailable") return "unavailable"
  return error.problem === "s3_incomplete" ? "not_configured" : "misconfigured"
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
 * Storage is required because every uploaded file goes through it, whichever
 * driver is active. Marking an installation complete while the configured
 * backend is unusable hands the operator an admin panel where the File Manager,
 * the editor's image picker and every upload fail, with nothing having warned
 * them — and it does so at the exact moment they would have been able to fix
 * the configuration easily.
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
