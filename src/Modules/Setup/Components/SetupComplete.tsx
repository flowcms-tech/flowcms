"use client"

/**
 * What an operator sees after the one moment this page exists for.
 *
 * NO CREDENTIALS ARE RETURNED OR REPEATED — not the password, not the setup
 * token, not even the owner's email. Everything on this screen is either a
 * static sentence or a path the server resolved.
 *
 * `loginPath` comes from `adminLoginPath()` on the server, so it reflects
 * FLOWCMS_ADMIN_PATH. It is never hardcoded, and it is never the internal
 * `/admin-panel` route, which is not a usable external path.
 */
export default function SetupComplete({ loginPath }: { loginPath: string }) {
  return (
    <div className="w-full max-w-lg text-center">
      <h1 className="text-xl font-bold text-foreground">FlowCMS is ready</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your owner account has been created and this installation is now initialized. First-run
        setup is closed permanently.
      </p>
      <a
        href={loginPath}
        className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
      >
        Go to sign in
      </a>
      <p className="mt-4 text-xs text-muted-foreground">
        Set your brand, theme and integrations from Settings once you have signed in.
      </p>
    </div>
  )
}
