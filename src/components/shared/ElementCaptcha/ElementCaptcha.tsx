"use client"

import * as React from "react"
import { Controller, useFormContext } from "react-hook-form"
import type { UseFormReturn, Control, FieldError } from "react-hook-form"
import { cn } from "@/lib/utils"
import type { ClassValue } from "clsx"
import { AnimatePresence, motion } from "framer-motion"
import { RefreshCw } from "lucide-react"
import { Input } from "@/components/ui/input"
import ElementLabelHint from "@/components/shared/ElementLabelHint/ElementLabelHint"

// --- Types --------------------------------------------------------------------

export interface ElementCaptchaClassNames {
  root?: ClassValue
  label?: ClassValue
  requiredMark?: ClassValue
  /** Flex row that contains image, refresh button, and input */
  imageRow?: ClassValue
  /** The <img> element — clicking it also refreshes */
  image?: ClassValue
  /** The refresh <button> element */
  refreshButton?: ClassValue
  /** Wrapper around the input + boxBelow error, fills remaining row space */
  inputWrapper?: ClassValue
  input?: ClassValue
  hint?: ClassValue
  error?: ClassValue
}

export interface ElementCaptchaProps {
  // -- Form ------------------------------------------------------------------
  name?: string
  control?: Control
  // -- Standalone ------------------------------------------------------------
  value?: string
  onChange?: (value: string) => void
  onBlur?: () => void
  // -- Visual ----------------------------------------------------------------
  label?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  // -- Error -----------------------------------------------------------------
  errorVariant?: "default" | "boxBelow"
  // -- Styling ---------------------------------------------------------------
  className?: string
  classNames?: ElementCaptchaClassNames
  /**
   * Base API path for the captcha image. A `?v=<nonce>` is appended on each
   * fetch to bypass the browser cache. Override in tests.
   * @default "/api/captcha"
   */
  apiPath?: string
  /**
   * Increment this number to force a new captcha image and clear the input.
   * Use this after a failed login to give the user a fresh code.
   */
  resetKey?: number
}

// --- Core render --------------------------------------------------------------

interface CaptchaCoreProps
  extends Omit<ElementCaptchaProps, "name" | "control" | "value" | "onChange"> {
  name?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: FieldError
  resetKey?: number
}

function CaptchaCore({
  name,
  value,
  onChange,
  onBlur,
  error,
  label,
  hint,
  required = false,
  disabled = false,
  errorVariant = "default",
  className,
  classNames = {},
  apiPath = "/api/captcha",
  resetKey,
}: CaptchaCoreProps) {
  const [nonce, setNonce] = React.useState(0)
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)
  const hasError = !!error

  // When apiPath is a data URI (e.g. a test fixture), use it as-is.
  const isDataUri = apiPath.startsWith("data:")

  // -- Image fetch -----------------------------------------------------------
  // The endpoint mints a NEW code and overwrites the captcha_token cookie on
  // every hit, so the image the user reads must come from exactly one request.
  // Rendering `<img src={apiPath}>` directly is not safe: Next emits a
  // <link rel="preload" as="image"> for it, the no-store response makes that
  // preload unreusable by the <img>, and a nonce derived from Date.now()
  // mismatches between SSR and hydration — three requests, three codes, and
  // the surviving cookie belongs to whichever finished last, not to the image
  // on screen. Fetching the blob here keeps it to a single request whose
  // response both sets the cookie and supplies the pixels.
  const objectUrlRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (isDataUri) return

    const controller = new AbortController()
    let cancelled = false

    fetch(`${apiPath}?v=${nonce}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Captcha request failed: ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = url
        setImageSrc(url)
      })
      .catch((err: unknown) => {
        if (cancelled || (err as Error)?.name === "AbortError") return
        setImageSrc(null)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [apiPath, isDataUri, nonce])

  // Release the last blob URL on unmount.
  React.useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    },
    []
  )

  // -- External reset (e.g. after a failed login) ----------------------------
  // Only responds to explicit resetKey increments from the parent, not to the
  // user typing or clearing the input field.
  const mountedReset = React.useRef(false)
  React.useEffect(() => {
    if (!mountedReset.current) {
      mountedReset.current = true
      return
    }
    setNonce((n) => n + 1)
  }, [resetKey])

  const refresh = () => {
    if (disabled) return
    onChange("")
    setNonce((n) => n + 1)
  }

  // Data URIs render straight from the prop; real captchas wait for the blob.
  const displaySrc = isDataUri ? apiPath : imageSrc

  return (
    <div className={cn("flex flex-col gap-1.5", classNames.root, className)}>
      {/* Label */}
      {label && (
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={name}
            className={cn(
              "text-sm font-medium leading-none",
              hasError ? "text-destructive" : "text-foreground",
              disabled && "opacity-50 cursor-not-allowed",
              classNames.label
            )}
          >
            {label}
            {required && (
              <span className={cn("text-destructive ms-0.5", classNames.requiredMark)}>
                *
              </span>
            )}
          </label>
          {hint && <ElementLabelHint id={`${name}-hint`} text={hint} />}
        </div>
      )}

      {/*
        Single row: image | refresh button | input (flex-1).
        Image click and button click both refresh.
        No default visual styles on image/refreshButton — consumer styles via classNames.
      */}
      <div className={cn("flex items-center gap-2", classNames.imageRow)}>
        {/* RTL order: input (right) → image (middle) → refresh button (left) */}

        {/* Input fills remaining row space — rightmost in RTL */}
        <div className={cn("flex-1 min-w-0", classNames.inputWrapper)}>
          <Input
            id={name}
            value={value}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            onBlur={onBlur}
            disabled={disabled}
            autoComplete="off"
            aria-invalid={hasError}
            aria-describedby={
              hasError ? `${name}-error` : hint ? `${name}-hint` : undefined
            }
            className={cn(
              "focus-visible:ring-0 aria-invalid:ring-0 h-10 font-mono tracking-widest",
              errorVariant === "boxBelow" && hasError && "rounded-b-none border-b-0",
              classNames.input
            )}
          />

          {/* boxBelow error — attaches directly under the input */}
          <AnimatePresence initial={false}>
            {errorVariant === "boxBelow" && hasError && (
              <motion.div
                id={`${name}-error`}
                role="alert"
                key="box-error"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div
                  className={cn(
                    "text-sm text-destructive rounded-b-lg px-2.5 py-2 bg-destructive/5",
                    "border border-destructive border-t-0",
                    classNames.error
                  )}
                >
                  {error?.message}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Image — middle in RTL. Placeholder holds the slot until the blob
            arrives so the row doesn't shift. */}
        {displaySrc ? (
          <img
            key={nonce}
            src={displaySrc}
            alt="Security code"
            draggable={false}
            onClick={disabled ? undefined : refresh}
            className={cn(!disabled && "cursor-pointer", classNames.image)}
          />
        ) : (
          <div
            aria-hidden
            style={{ aspectRatio: "140 / 44" }}
            onClick={disabled ? undefined : refresh}
            className={cn(
              "shrink-0 animate-pulse bg-muted",
              !disabled && "cursor-pointer",
              classNames.image
            )}
          />
        )}

        {/* Refresh button — leftmost in RTL */}
        <button
          type="button"
          onClick={refresh}
          disabled={disabled}
          aria-label="Refresh security code"
          className={cn(classNames.refreshButton)}
        >
          <RefreshCw size={16} aria-hidden />
        </button>
      </div>

      {/* default error */}
      <AnimatePresence initial={false}>
        {errorVariant !== "boxBelow" && hasError && (
          <motion.p
            id={`${name}-error`}
            role="alert"
            key="default-error"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className={cn("text-sm text-destructive", classNames.error)}
          >
            {error?.message}
          </motion.p>
        )}
      </AnimatePresence>

    </div>
  )
}

// --- ElementCaptcha — dual-mode form wrapper ----------------------------------

export default function ElementCaptcha({
  name,
  control: controlProp,
  value: valueProp,
  onChange: onChangeProp,
  onBlur: onBlurProp,
  ...rest
}: ElementCaptchaProps) {
  const formCtx = useFormContext() as UseFormReturn | null
  const effectiveControl = controlProp ?? formCtx?.control

  if (name && effectiveControl) {
    return (
      <Controller
        name={name}
        control={effectiveControl}
        defaultValue=""
        render={({ field, fieldState: { error } }) => (
          <CaptchaCore
            {...rest}
            name={name}
            value={field.value ?? ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={error}
          />
        )}
      />
    )
  }

  return (
    <CaptchaCore
      {...rest}
      name={name}
      value={valueProp ?? ""}
      onChange={onChangeProp ?? (() => {})}
      onBlur={onBlurProp}
    />
  )
}
