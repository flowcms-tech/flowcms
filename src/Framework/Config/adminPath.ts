import "server-only"
import {
  INTERNAL_ADMIN_PATH,
  joinAdminPath,
  resolveAdminPathFrom,
} from "./adminPathCore"

/**
 * The server's view of the admin path: `adminPathCore` plus `process.env`.
 *
 * Server code calls these helpers rather than reading the environment, which is
 * what makes moving the panel an operational change instead of a
 * search-and-replace across a hundred files.
 *
 * Two other modules read FLOWCMS_ADMIN_PATH directly, and both are deliberate:
 * `src/proxy.ts` and `src/Framework/Auth/auth.config.ts`. Neither may import
 * `server-only` — the proxy has its own bundle, and auth.config is pulled into
 * it — so they call `resolveAdminPathFrom` from the pure core instead. The
 * architecture test in `tests/architecture/adminPathUsage.test.ts` pins that
 * list at exactly three files so a fourth cannot appear quietly.
 *
 * Resolved once at module load. The value cannot change without a restart,
 * which is the documented contract rather than an oversight: resolving per call
 * would surface an invalid value at some arbitrary later request instead of at
 * startup, which is the opposite of what a configuration error should do.
 */
const PUBLIC_ADMIN_PATH = resolveAdminPathFrom(process.env.FLOWCMS_ADMIN_PATH)

/** The externally visible admin root, e.g. `/admin` or `/control-center`. */
export function getAdminPath(): string {
  return PUBLIC_ADMIN_PATH
}

/** The internal App Router root. Exported for routing code; never a public URL. */
export function getInternalAdminPath(): string {
  return INTERNAL_ADMIN_PATH
}

/** Build a public admin URL: `adminPath("/blog/posts")` → `/admin/blog/posts`. */
export function adminPath(sub?: string): string {
  return joinAdminPath(PUBLIC_ADMIN_PATH, sub)
}

export function adminLoginPath(): string {
  return adminPath("/login")
}

export function adminDashboardPath(): string {
  return adminPath("/dashboard")
}
