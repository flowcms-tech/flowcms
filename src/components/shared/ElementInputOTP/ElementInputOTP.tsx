"use client"

import * as React from "react"
import { Controller, useFormContext } from "react-hook-form"
import type { UseFormReturn, Control, FieldError } from "react-hook-form"
import { cn } from "@/lib/utils"
import type { ClassValue } from "clsx"
import { AnimatePresence, motion } from "framer-motion"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@/components/ui/input-otp"

// --- Types --------------------------------------------------------------------

export interface ElementInputOTPClassNames {
  root?: ClassValue
  label?: ClassValue
  requiredMark?: ClassValue
  container?: ClassValue
  group?: ClassValue
  slot?: ClassValue
  separator?: ClassValue
  hint?: ClassValue
  error?: ClassValue
}

export interface ElementInputOTPProps {
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
  // -- OTP config ------------------------------------------------------------
  /** Number of groups. Default: 4 */
  groups?: number
  /** Digits per group. Default: 4  (total = groups × groupSize) */
  groupSize?: number
  /** ReactNode rendered between groups. Default: "-" */
  separator?: React.ReactNode
  // -- Error -----------------------------------------------------------------
  errorVariant?: "default" | "boxBelow"
  // -- Styling ---------------------------------------------------------------
  className?: string
  classNames?: ElementInputOTPClassNames
}

// --- Core render --------------------------------------------------------------

interface OTPCoreProps
  extends Omit<ElementInputOTPProps, "name" | "control" | "value" | "onChange"> {
  name?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: FieldError
}

function OTPCore({
  name,
  value,
  onChange,
  onBlur,
  error,
  label,
  hint,
  required = false,
  disabled = false,
  groups = 4,
  groupSize = 4,
  separator = "-",
  errorVariant = "default",
  className,
  classNames = {},
}: OTPCoreProps) {
  const totalLength = groups * groupSize
  const hasError = !!error

  const groupSlots = React.useMemo(
    () =>
      Array.from({ length: groups }, (_, g) =>
        Array.from({ length: groupSize }, (_, s) => g * groupSize + s)
      ),
    [groups, groupSize]
  )

  return (
    <div className={cn("flex flex-col gap-1.5", classNames.root, className)}>
      {/* Label */}
      {label && (
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
      )}

      <div>
        {/* Wrap in ltr so digit order is always left-to-right even in RTL forms */}
        <div dir="ltr">
          <InputOTP
            id={name}
            maxLength={totalLength}
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            disabled={disabled}
            pattern={REGEXP_ONLY_DIGITS}
            aria-invalid={hasError}
            aria-describedby={
              hasError ? `${name}-error` : hint ? `${name}-hint` : undefined
            }
            containerClassName={cn(
              "flex items-center gap-2 w-full",
              classNames.container
            )}
          >
            {groupSlots.map((slots, groupIdx) => (
              <React.Fragment key={groupIdx}>
                {groupIdx > 0 && (
                  <InputOTPSeparator className={cn(classNames.separator)}>
                    {separator}
                  </InputOTPSeparator>
                )}
                <InputOTPGroup className={cn("flex flex-1", classNames.group)}>
                  {slots.map((slotIdx) => (
                    <InputOTPSlot
                      key={slotIdx}
                      index={slotIdx}
                      hasError={hasError}
                      className={cn(
                        "flex-1 w-auto",
                        errorVariant === "boxBelow" &&
                          hasError &&
                          groupIdx === groups - 1 &&
                          "last:rounded-br-none",
                        classNames.slot
                      )}
                    />
                  ))}
                </InputOTPGroup>
              </React.Fragment>
            ))}
          </InputOTP>
        </div>

        {/* boxBelow error — attaches below the OTP container */}
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

      {/* default error — slides below */}
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

      {/* Hint */}
      {!hasError && hint && (
        <p
          id={`${name}-hint`}
          className={cn("text-sm text-muted-foreground", classNames.hint)}
        >
          {hint}
        </p>
      )}
    </div>
  )
}

// --- ElementInputOTP — dual-mode form wrapper ---------------------------------

export default function ElementInputOTP({
  name,
  control: controlProp,
  value: valueProp,
  onChange: onChangeProp,
  onBlur: onBlurProp,
  ...rest
}: ElementInputOTPProps) {
  const formCtx = useFormContext() as UseFormReturn | null
  const effectiveControl = controlProp ?? formCtx?.control

  if (name && effectiveControl) {
    return (
      <Controller
        name={name}
        control={effectiveControl}
        defaultValue=""
        render={({ field, fieldState: { error } }) => (
          <OTPCore
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
    <OTPCore
      {...rest}
      name={name}
      value={valueProp ?? ""}
      onChange={onChangeProp ?? (() => {})}
      onBlur={onBlurProp}
    />
  )
}

