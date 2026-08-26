import Link from "next/link"
import LoginThreeBackground from "@/components/LoginThreeBackground"
import LoginModule from "@/Modules/Authentication/LoginModule"
import { getSetupStatus } from "@/Framework/Setup/setupState"

/**
 * `setupRequired` is the only thing this page learned in Phase 7.1, and it is
 * deliberately the smallest possible change.
 *
 * An operator who deployed FlowCMS and went straight to the admin path used to
 * find a sign-in form that no password on earth would satisfy, because no
 * account existed. One sentence and a link fixes that.
 *
 * It leaks nothing. `/setup` is a fixed public path that anyone can already
 * request, and the notice appears ONLY while the installation is uninitialized
 * — a state in which there is no admin panel to protect and nothing private to
 * disclose. Once setup completes, this page is exactly what it was before.
 *
 * The reverse direction is the one that would leak: the setup page must not
 * advertise the configured admin path before ownership exists. It does not —
 * see `SetupComplete`, which only appears after a successful completion.
 */
export default async function AdminLoginPage() {
  const setupRequired = (await getSetupStatus()).state === "incomplete"

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-8">
      <LoginThreeBackground />
      <div className="relative z-10 rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-md shadow-2xl">
        {setupRequired && (
          <div
            role="status"
            className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          >
            <p className="font-medium text-foreground">This installation is not initialized</p>
            <p className="mt-1 text-muted-foreground">
              No account exists yet.{" "}
              <Link href="/setup" className="underline underline-offset-2">
                Open setup
              </Link>{" "}
              to create the owner account.
            </p>
          </div>
        )}
        <LoginModule />
      </div>
    </main>
  )
}
