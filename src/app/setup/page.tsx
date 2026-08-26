import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { checkPrerequisites } from "@/Framework/Setup/prerequisites"
import { getSetupStatus } from "@/Framework/Setup/setupState"
import { classifySetupToken, readConfiguredSetupToken } from "@/Framework/Setup/setupToken"
import SetupModule from "@/Modules/Setup/SetupModule"

/**
 * First-run setup.
 *
 * A FIXED PUBLIC PATH, deliberately not under `FLOWCMS_ADMIN_PATH`. The admin
 * path exists to move the authenticated panel; there is no authenticated panel
 * here, and nothing for it to protect. A future installer also needs exactly
 * one deterministic URL to print, and "wherever you configured the admin path,
 * plus /setup" is not one.
 *
 * IT ONLY EXISTS WHILE SETUP IS INCOMPLETE. Afterwards it 404s, rather than
 * becoming a page that says "already installed" for the life of the
 * installation — that page would be a permanent public confirmation of what
 * this software is, and an invitation to keep probing. The mutation refuses
 * underneath regardless, so the 404 is the outer layer, not the only one.
 *
 * `blocked` — the database is unreachable — 404s too. Serving a first-run form
 * during an outage would offer ownership of a live site to whoever happened to
 * be looking.
 *
 * The page is a server component; the form is the only client part. Prerequisite
 * probes and token classification happen here, where their inputs are, and only
 * their states cross to the browser.
 */

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Set up FlowCMS",
  // An uninitialized installation should never be indexed. It is a transient
  // state whose URL is worthless once it ends, and search results pointing at
  // fresh installs are a discovery channel for exactly the wrong audience.
  robots: { index: false, follow: false },
}

export default async function SetupPage() {
  if ((await getSetupStatus()).state !== "incomplete") notFound()

  const [prerequisites, token] = await Promise.all([
    checkPrerequisites(),
    Promise.resolve(classifySetupToken(readConfiguredSetupToken())),
  ])

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <SetupModule
        database={prerequisites.database}
        storage={prerequisites.storage}
        captcha={prerequisites.captcha}
        auth={prerequisites.auth}
        tokenConfigured={token.state === "usable"}
        // The RULE that was broken, never the value that broke it.
        tokenProblem={token.message}
      />
    </main>
  )
}
