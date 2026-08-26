"use client"

import { useState } from "react"
import { useForm, FormProvider } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { signIn } from "next-auth/react"
import { useRouter } from "@bprogress/next/app"
import ElementInput from "@/components/shared/ElementInput/ElementInput"
import ElementButton from "@/components/shared/ElementButton/ElementButton"
import ElementCaptcha from "@/components/shared/ElementCaptcha/ElementCaptcha"
import LoginAlert from "./Components/LoginAlert"
import LoginSuccess from "./Components/LoginSuccess"
import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { loginSchema, type LoginFormValues } from "./Functions/Validations"

/**
 * Maps the provider's refusal code to something a person can act on.
 *
 * Deliberately does NOT distinguish "no such account" from "wrong password" —
 * both arrive as the same code, so the login screen cannot be used to find out
 * which email addresses are registered.
 */
function signInErrorMessage(code: string | undefined): string {
  switch (code) {
    case "captcha":
      return "Incorrect or expired security code. Please try again."
    case "rate_limited":
      return "Too many sign-in attempts. Please wait a few minutes and try again."
    default:
      return "Invalid email or password."
  }
}

export default function LoginModule() {
  const router = useRouter()
  const adminHref = useAdminHref()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  const [isSuccess, setIsSuccess] = useState(false)

  const methods = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", captcha: "" },
  })

  const {
    handleSubmit,
    setValue,
    clearErrors,
    formState: { isSubmitting },
  } = methods

  const resetCaptcha = () => {
    setCaptchaKey((k) => k + 1)
    setValue("captcha", "", { shouldValidate: false })
    clearErrors("captcha")
  }

  const onSubmit = async (values: LoginFormValues) => {
    setErrorMessage(null)
    try {
      // The security code is submitted WITH the credentials, not verified in a
      // separate step beforehand. That earlier shape was decorative: the
      // credentials endpoint did not check the captcha itself, so anything
      // posting straight at it skipped this component entirely. Verification
      // now happens inside the Credentials provider's authorize().
      const result = await signIn("credentials", {
        email: values.email,
        password: values.password,
        captcha: values.captcha,
        redirect: false,
      })

      if (!result || result.error) {
        setErrorMessage(signInErrorMessage(result?.code))
        resetCaptcha()
        return
      }

      setIsSuccess(true)
      router.push(adminHref("/dashboard"))
    } catch {
      setErrorMessage("Something went wrong. Please try again.")
      resetCaptcha()
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your admin credentials
        </p>
      </div>

      <FormProvider {...methods}>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <LoginAlert message={errorMessage} />
          <LoginSuccess isShown={isSuccess} />

          <ElementInput
            name="email"
            type="email"
            label="Email"
            placeholder="Enter your email"
            required
          />

          <ElementInput
            name="password"
            type="password"
            label="Password"
            placeholder="Enter your password"
            required
          />

          <ElementCaptcha
            name="captcha"
            label="Security code"
            required
            resetKey={captchaKey}
            classNames={{
              image: "h-10 rounded-lg border border-input select-none",
              refreshButton:
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            }}
          />

          <ElementButton
            type="submit"
            size="lg"
            isLoading={isSubmitting}
            className="mt-2 w-full"
          >
            Sign in
          </ElementButton>
        </form>
      </FormProvider>
    </div>
  )
}
