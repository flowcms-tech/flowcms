import { NextResponse } from "next/server"
import {
  buildReadinessReport,
  checkDatabase,
  checkStorage,
} from "@/Framework/Health/readiness"
import { getSetupStatus } from "@/Framework/Setup/setupState"
import { getCaptchaConfig } from "@/Framework/Captcha/captchaConfig"
import { getAuthSecretConfig } from "@/Framework/Auth/authSecretConfig"

/**
 * Readiness: can this instance serve FlowCMS traffic? The Docker healthcheck
 * targets this route.
 *
 * Phase 3 established that this application can bind its port while serving
 * nothing but 500s — an invalid FLOWCMS_ADMIN_PATH fails the instrumentation
 * hook without stopping the process. A TCP check reports that as healthy. This
 * route does not: in that state the handler 500s along with everything else and
 * the container is marked unhealthy, which is the whole reason the healthcheck
 * is an HTTP request rather than a port probe.
 *
 * Returns 503 when not ready, because that is the status every orchestrator
 * already understands.
 *
 * The payload is states only. This endpoint is unauthenticated infrastructure,
 * so it must never carry an endpoint hostname, a bucket name, a credential, or
 * exception text; `tests/framework/readiness.test.ts` enforces that.
 */
export const dynamic = "force-dynamic"

export async function GET() {
  const [database, storage, setupStatus] = await Promise.all([
    checkDatabase(),
    checkStorage(),
    getSetupStatus(),
  ])

  // Reported, never gating. An operator who has not finished first-run setup
  // has a working container; see the note in buildReadinessReport.
  const setup =
    setupStatus.state === "complete"
      ? "complete"
      : setupStatus.state === "incomplete"
        ? "incomplete"
        : "unknown"

  // Reported AND gating, unlike storage: CAPTCHA_SECRET is env-only, so it
  // cannot be corrected from inside a running container — the fix is a restart
  // with the variable set. See the note in buildReadinessReport.
  const captchaConfig = getCaptchaConfig()
  // Reported and gating for the same reason, and kept SEPARATE from captcha so
  // an operator learns which variable to set.
  const authConfigStatus = getAuthSecretConfig()

  const { httpStatus, ...report } = buildReadinessReport({
    database,
    storage,
    setup,
    captcha: captchaConfig.state,
    auth: authConfigStatus.state,
  })
  return NextResponse.json(report, { status: httpStatus })
}
