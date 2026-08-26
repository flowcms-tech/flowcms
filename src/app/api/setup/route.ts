import { NextResponse, type NextRequest } from "next/server"
import { adminLoginPath } from "@/Framework/Config/adminPath"
import { recordActivity } from "@/db/activityLog"
import { completeSetup } from "@/Framework/Setup/completeSetup"
import { checkPrerequisites } from "@/Framework/Setup/prerequisites"
import { isSameOriginRequest } from "@/Framework/Setup/sameOrigin"
import { getSetupStatus } from "@/Framework/Setup/setupState"
import {
  classifySetupToken,
  readConfiguredSetupToken,
  verifySetupToken,
} from "@/Framework/Setup/setupToken"
import { registerSetupAttempt, setupClientIp } from "@/Framework/Setup/setupProtection"
import { setupSchema } from "@/Modules/Setup/Values/Validations"

/**
 * First-run setup — the only unauthenticated mutation in FlowCMS that creates
 * an account.
 *
 * It is a TRANSPORT SHELL. Every rule it enforces belongs to
 * `src/Framework/Setup/`, so the future `create-flowcms` installer can reuse
 * the semantics instead of reimplementing them from this file.
 *
 * WHY IT IS PUBLIC, AND WHAT REPLACES THE SESSION
 *
 * There is no session to require: this endpoint exists precisely because no
 * account exists yet. Five independent controls stand in for one, and the
 * policy entry in `routePolicies.ts` names all five:
 *
 *   1. It only answers while `settings.setupCompletedAt` is null. After that,
 *      404 — the endpoint is gone, not merely refusing.
 *   2. `FLOWCMS_SETUP_TOKEN`, a high-entropy deployment secret with no default,
 *      compared in constant time and never echoed.
 *   3. Rate limiting per client IP, consumed before any expensive work.
 *   4. Same-origin enforcement, so a hostile page cannot submit the form on an
 *      operator's behalf.
 *   5. One-time completion, guarded transactionally rather than by this file.
 *
 * WHY 404 AND NOT "ALREADY INSTALLED"
 *
 * An endpoint that answers "already installed" forever is a permanent, publicly
 * reachable surface that confirms the software and invites probing. Once setup
 * is closed both verbs behave as if the route does not exist. The 409 below is
 * for the genuine race — a request that began while setup was open and lost —
 * which is a different situation and deserves a different answer.
 *
 * ORDER MATTERS. The status check is first, so a completed installation reveals
 * nothing about tokens, rate limits or prerequisites. Rate limiting is second,
 * so an attacker cannot use this route to make the server hash passwords.
 */

export const dynamic = "force-dynamic"

/** Uniform refusal. Never says which of the five controls fired. */
function gone() {
  return NextResponse.json({ message: "Not found" }, { status: 404 })
}

export async function GET() {
  const status = await getSetupStatus()

  // `blocked` deliberately falls here too. A database outage must not expose
  // the setup surface, and it must not be reported to an anonymous caller
  // either — /api/ready is where infrastructure state is published.
  if (status.state !== "incomplete") return gone()

  const [prerequisites, token] = await Promise.all([
    checkPrerequisites(),
    Promise.resolve(classifySetupToken(readConfiguredSetupToken())),
  ])

  return NextResponse.json({
    data: {
      setupRequired: true,
      database: prerequisites.database,
      storage: prerequisites.storage,
      // Login CAPTCHA configuration. A state, never anything derived from the
      // secret — see Framework/Captcha/captchaConfig.
      captcha: prerequisites.captcha,
      auth: prerequisites.auth,
      // Whether a token is CONFIGURED, never anything about its value. The page
      // needs this to explain a locked form; it is the same fact an operator
      // could infer from the form refusing every answer.
      setupTokenConfigured: token.state === "usable",
      setupTokenProblem: token.state === "usable" ? null : token.message,
      canComplete: prerequisites.satisfied && token.state === "usable",
    },
    message: "Setup required",
  })
}

export async function POST(request: NextRequest) {
  // 1. Is setup even open? Before anything else, so a completed installation is
  //    indistinguishable from a nonexistent route.
  if ((await getSetupStatus()).state !== "incomplete") return gone()

  // 2. Rate limit, before token comparison and before bcrypt. A throttled
  //    attempt costs this process one Redis INCR.
  const throttle = await registerSetupAttempt(setupClientIp(request.headers))
  if (throttle.limited) {
    return NextResponse.json(
      { message: "Too many setup attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } },
    )
  }

  // 3. Same-origin. A setup token is not a reason to accept a cross-site POST:
  //    the operator holding the token is exactly who a hostile page would ride.
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json({ message: "Setup must be submitted from this site." }, { status: 403 })
  }

  // 4. Is the deployment's token usable at all? Reported as a server
  //    configuration problem, because it is one — and with the RULE that was
  //    broken, never the value.
  const configured = readConfiguredSetupToken()
  const classification = classifySetupToken(configured)
  if (classification.state !== "usable") {
    return NextResponse.json({ message: classification.message }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid request body" }, { status: 400 })
  }

  const parsed = setupSchema.safeParse(body)
  if (!parsed.success) {
    // Zod's own issue objects carry the offending INPUT. These responses are
    // rendered on a public page, and one of the fields is the setup token, so
    // only the messages travel — never `parsed.error`, never `issue.input`.
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 },
    )
  }

  // 5. The token itself. Deliberately checked AFTER shape validation so a
  //    malformed request cannot be used to time the comparison, and answered
  //    generically so a wrong token learns nothing beyond "no".
  if (!verifySetupToken(configured, parsed.data.setupToken)) {
    return NextResponse.json({ message: "Setup authorization failed." }, { status: 401 })
  }

  // 6. Prerequisites. Checked here rather than trusted from whatever the page
  //    rendered minutes ago — storage can break between page load and submit,
  //    and marking an installation complete without usable media storage hands
  //    the operator an admin panel where every upload fails.
  const prerequisites = await checkPrerequisites()
  if (!prerequisites.satisfied) {
    return NextResponse.json(
      {
        message: ["Setup cannot complete until the deployment prerequisites are met."],
        data: {
          database: prerequisites.database,
          storage: prerequisites.storage,
          captcha: prerequisites.captcha,
          auth: prerequisites.auth,
        },
      },
      { status: 503 },
    )
  }

  const result = await completeSetup({
    siteName: parsed.data.siteName,
    tagline: parsed.data.tagline || null,
    ownerEmail: parsed.data.ownerEmail,
    ownerPassword: parsed.data.ownerPassword,
    ownerName: parsed.data.ownerName || null,
  })

  if (!result.ok) {
    if (result.reason === "invalid") {
      return NextResponse.json({ message: result.messages }, { status: 422 })
    }
    // The race: setup was open when this request started and closed before its
    // transaction committed. A conflict, not a 404, because the caller did
    // reach a live endpoint — and the distinction is what makes the second
    // browser tab show something a human can act on.
    return NextResponse.json({ message: "Setup has already been completed." }, { status: 409 })
  }

  // After the write and after cache invalidation, matching every other route.
  // No password, no token, no metadata: an audit entry that carries a secret is
  // a secret in a table people read casually.
  await recordActivity({
    actor: { id: result.ownerId, email: result.ownerEmail },
    action: "created",
    entityType: "installation",
    entityId: null,
    entityLabel: parsed.data.siteName,
    summary: "First-run setup completed",
  })

  return NextResponse.json({
    data: {
      // Resolved server-side from FLOWCMS_ADMIN_PATH. Never hardcoded, and
      // never the internal /admin-panel route.
      loginPath: adminLoginPath(),
    },
    message: "Setup complete",
  })
}
