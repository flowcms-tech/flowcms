"use client"

import { useState } from "react"
import { FormProvider, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import ElementInput from "@/components/shared/ElementInput/ElementInput"
import ElementButton from "@/components/shared/ElementButton/ElementButton"
import ValidationBox from "@/components/shared/Validations/ValidationBox"
import { setupSchema, type SetupFormValues } from "./Values/Validations"
import PrerequisiteList, { type PrerequisiteState } from "./Components/PrerequisiteList"
import SetupComplete from "./Components/SetupComplete"

/**
 * The first-run setup form.
 *
 * Deliberately small. Themes, menus, SEO integrations, analytics, SMTP and a
 * business profile all belong in Admin AFTER initialization: a setup wizard
 * that asks fifteen questions is one an operator abandons half-way, leaving an
 * installation in a state the product then has to model. This asks the two
 * things that cannot be deferred — who owns this, and what is it called — and
 * shows whether the deployment can actually run.
 *
 * THE SERVER IS AUTHORITATIVE FOR EVERYTHING. This component renders state it
 * was handed and posts a form; it does not decide whether setup is open, does
 * not validate the token, and does not re-check prerequisites for the purposes
 * of allowing submission. `POST /api/setup` re-checks all of it, because a page
 * rendered ten minutes ago is not evidence about anything.
 */

export interface SetupModuleProps {
  database: PrerequisiteState
  storage: PrerequisiteState
  captcha: PrerequisiteState
  auth: PrerequisiteState
  /** Whether a usable FLOWCMS_SETUP_TOKEN is configured for this deployment. */
  tokenConfigured: boolean
  /** Operator-facing reason the token is unusable. Never contains the value. */
  tokenProblem: string | null
}

export default function SetupModule({
  database,
  storage,
  captcha,
  auth,
  tokenConfigured,
  tokenProblem,
}: SetupModuleProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [loginPath, setLoginPath] = useState<string | null>(null)

  const methods = useForm<SetupFormValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      siteName: "",
      tagline: "",
      ownerName: "",
      ownerEmail: "",
      ownerPassword: "",
      confirmPassword: "",
      // NEVER pre-filled from the server, even though the server knows it.
      // Putting the deployment secret in the HTML would hand it to anything
      // that can read the page — an extension, a screenshot, a proxy cache.
      setupToken: "",
    },
  })

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods

  const onSubmit = async (values: SetupFormValues) => {
    setServerErrors([])
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `same-origin` is the default, and stated anyway: the endpoint
        // enforces same-origin server-side, and this is the client half of the
        // same decision.
        credentials: "same-origin",
        body: JSON.stringify(values),
      })

      const payload = (await response.json().catch(() => null)) as
        | { data?: { loginPath?: string }; message?: string | string[] }
        | null

      if (!response.ok) {
        const message = payload?.message
        setServerErrors(
          Array.isArray(message)
            ? message
            : [message ?? "Setup could not be completed. Please try again."],
        )
        return
      }

      setLoginPath(payload?.data?.loginPath ?? null)
    } catch {
      setServerErrors(["Setup could not be completed. Please try again."])
    }
  }

  if (loginPath) return <SetupComplete loginPath={loginPath} />

  const blocked = !tokenConfigured

  return (
    <div className="w-full max-w-lg">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Set up FlowCMS</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This installation has not been initialized yet. Create the owner account to finish.
        </p>
      </div>

      <PrerequisiteList database={database} storage={storage} captcha={captcha} auth={auth} />

      {blocked ? (
        <div
          role="status"
          className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-foreground"
        >
          <p className="font-medium">Web setup is locked</p>
          <p className="mt-1 text-muted-foreground">{tokenProblem}</p>
          <p className="mt-2 text-muted-foreground">
            An operator with server access can create the first owner directly with{" "}
            <code className="rounded bg-muted px-1 py-0.5">scripts/bootstrap-owner.mjs</code>.
          </p>
        </div>
      ) : (
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-4" noValidate>
            <ValidationBox messages={serverErrors} />

            <fieldset className="flex flex-col gap-4">
              <legend className="mb-2 text-sm font-semibold text-foreground">Site</legend>
              <ElementInput
                name="siteName"
                label="Site name"
                placeholder="Your site's name"
                autoComplete="organization"
                required
              />
              <ElementInput
                name="tagline"
                label="Tagline"
                placeholder="Optional short description"
                autoComplete="off"
              />
            </fieldset>

            <fieldset className="flex flex-col gap-4">
              <legend className="mb-2 text-sm font-semibold text-foreground">Owner</legend>
              <ElementInput
                name="ownerName"
                label="Name"
                placeholder="Optional"
                autoComplete="name"
              />
              <ElementInput
                name="ownerEmail"
                type="email"
                label="Email"
                placeholder="you@example.com"
                autoComplete="username"
                required
              />
              <ElementInput
                name="ownerPassword"
                type="password"
                label="Password"
                placeholder="At least 12 characters"
                autoComplete="new-password"
                required
              />
              <ElementInput
                name="confirmPassword"
                type="password"
                label="Confirm password"
                autoComplete="new-password"
                required
              />
            </fieldset>

            <fieldset className="flex flex-col gap-4">
              <legend className="mb-2 text-sm font-semibold text-foreground">
                Setup authorization
              </legend>
              <ElementInput
                name="setupToken"
                type="password"
                label="Setup token"
                placeholder="From your deployment configuration"
                // `off`, not `new-password`: this is a deployment secret shared
                // by everyone who administers the server, not a credential
                // belonging to the person at the keyboard. A password manager
                // offering to save it under their identity is the wrong shape,
                // and it is never needed twice.
                autoComplete="off"
                required
              />
            </fieldset>

            <ElementButton type="submit" size="lg" isLoading={isSubmitting} className="mt-2 w-full">
              Complete setup
            </ElementButton>
          </form>
        </FormProvider>
      )}
    </div>
  )
}
