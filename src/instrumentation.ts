/**
 * Startup validation.
 *
 * `register()` runs once per server instance and must complete before the
 * server accepts requests, which makes it the earliest point FlowCMS can reject
 * a bad configuration.
 *
 * What this buys, precisely: with an invalid FLOWCMS_ADMIN_PATH, the process
 * logs `Failed to prepare server` and the full validation error at startup,
 * without waiting for a request to arrive. Every request then returns 500.
 *
 * What it does NOT do, equally precisely: the process does not exit. `next
 * start` has already bound the port by the time `register()` runs, and a throw
 * here fails preparation without tearing the process down. So a supervisor
 * watching only the exit code sees a live process — a health check that
 * actually issues a request will see 500s, and that is what to configure.
 * (Measured 2026-08-21; both behaviours verified.)
 *
 * Either way the important property holds: nothing is served, and the internal
 * `/admin-panel` route is not exposed as a fallback.
 *
 * Importing the config module is what performs the check — it resolves and
 * validates at module load. The call below exists so the import cannot be
 * dropped as unused.
 *
 * The theme registry is checked here for the same reason, plus one more. Route
 * dispatch does not reach it until Phase 6.2, so without this import nothing in
 * the application would load `src/Themes/registry.ts` at all — its validation
 * would run only under `vitest`, and Next's file tracer would leave it out of
 * the standalone build entirely. A guard that is absent from the artifact it
 * guards is not a guard. (Verified by grepping the built image; before this
 * import the registry's own error text was not in it.)
 */
export async function register() {
  const { getAdminPath } = await import("@/Framework/Config/adminPath")
  getAdminPath()

  const { getDefaultTheme } = await import("@/Themes/registry")
  getDefaultTheme()

  /**
   * CAPTCHA_SECRET — checked here, and deliberately LOGGED rather than thrown.
   *
   * It is required: without it no login CAPTCHA can be issued or verified, so
   * nobody can sign in to the admin panel. Before Phase 7.1.1 an operator found
   * that out at their first sign-in attempt — after first-run setup had already
   * completed into an installation they could never administer.
   *
   * WHY NOT THROW, WHEN AN INVALID ADMIN PATH DOES
   *
   * The two failures have different blast radii, and the response should match.
   * An invalid `FLOWCMS_ADMIN_PATH` breaks ROUTING: nothing can be served
   * correctly, so failing preparation and letting every request 500 is
   * proportionate. A missing `CAPTCHA_SECRET` breaks LOGIN. The public site —
   * every blog post, page, sitemap and feed — still serves perfectly, and
   * taking it down over an admin-panel problem would turn a configuration
   * mistake into an outage for readers who are not affected by it.
   *
   * So this logs loudly at startup and `/api/ready` fails, which marks the
   * container unhealthy while leaving it able to explain itself. That
   * combination is strictly more diagnosable than a blanket 500: a thrown
   * `register()` would take `/api/ready` down with everything else, and the
   * operator would lose the one endpoint that names the problem.
   *
   * The message never contains the value. See `captchaConfig.ts`.
   */
  const { getCaptchaConfig, logCaptchaConfigProblem } = await import(
    "@/Framework/Captcha/captchaConfig"
  )
  logCaptchaConfigProblem("startup configuration check", getCaptchaConfig())

  /**
   * AUTH_SECRET — same model, and the more dangerous of the two.
   *
   * A missing CAPTCHA_SECRET fails closed and loud: nobody can sign in. A weak
   * AUTH_SECRET fails OPEN and SILENT — everything works, including for anyone
   * who can read the value. Before Phase 7.1.2 nothing examined it at all, so a
   * deployment that copied `.env.example` verbatim signed real sessions with a
   * key published in this repository.
   *
   * Logged rather than thrown, for the reason above: this breaks the ADMIN
   * authentication system, not public content rendering. Throwing would fail
   * server preparation and take the reader-facing site down with it, and would
   * also take `/api/ready` down — losing the one endpoint that names the
   * problem. Auth.js is separately refused the weak value (see
   * `auth.config.ts`), so nothing is signed with it in the meantime.
   */
  const { getAuthSecretConfig, logAuthSecretProblem } = await import(
    "@/Framework/Auth/authSecretConfig"
  )
  logAuthSecretProblem("startup configuration check", getAuthSecretConfig())

  /**
   * AN INTERRUPTED STORAGE CUTOVER — reconciled here, and NOT awaited.
   *
   * A cutover that was interrupted leaves its migration in `cutting_over`, and
   * that job is the storage write lock: every upload in the application is
   * refused while it stands. A process that restarts into that state has to
   * resolve it, and it must not need an admin to open a page first — the people
   * best placed to notice are the ones whose uploads have stopped working.
   *
   * NOT AWAITED, deliberately. `register()` blocks the server from accepting
   * requests until it resolves, and this reads and writes the database, which is
   * exactly the thing that may be slow or unreachable at boot. Blocking startup
   * on it would turn a database that comes up ten seconds after the app into an
   * app that serves nothing for ten seconds — including `/api/ready`, the one
   * endpoint that could explain why.
   *
   * It is also not the only trigger. The same reconciliation runs whenever a
   * storage write is refused by the lock and whenever the migration state is
   * read, and every one of them is idempotent, so a failure here costs a delay
   * rather than a repair. See Framework/Storage/storageRecoveryTrigger.ts.
   */
  // NODE RUNTIME ONLY. `register()` is compiled for the Edge runtime as well,
  // because middleware runs there — and the recovery path reaches the database
  // client, the storage drivers and `node:crypto`, none of which exist in Edge.
  // Without this guard the Edge bundle pulls all of it in, warns about every
  // Node built-in on the way, and the call could only ever fail there.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { triggerStorageRecovery } = await import("@/Framework/Storage/storageRecoveryTrigger")
    triggerStorageRecovery()
  }
}
