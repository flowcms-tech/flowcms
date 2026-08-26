"use client"

import * as React from "react"
import { Controller, useFormContext } from "react-hook-form"
import type { UseFormReturn, Control, FieldError } from "react-hook-form"
import { cn } from "@/lib/utils"
import type { ClassValue } from "clsx"
import { AnimatePresence, motion } from "framer-motion"
import { Checkbox } from "@/components/ui/checkbox"
import ElementLabelHint from "@/components/shared/ElementLabelHint/ElementLabelHint"

// --- Types --------------------------------------------------------------------

export interface ElementCheckboxClassNames {
  root?: ClassValue
  row?: ClassValue
  checkbox?: ClassValue
  label?: ClassValue
  requiredMark?: ClassValue
  error?: ClassValue
}

export interface ElementCheckboxProps {
  // -- Form ------------------------------------------------------------------
  name?: string
  control?: Control
  // -- Standalone ------------------------------------------------------------
  value?: boolean
  onChange?: (value: boolean) => void
  onBlur?: () => void
  // -- Visual ----------------------------------------------------------------
  label?: string
  /** Short description revealed by an info icon next to the label. */
  hint?: string
  required?: boolean
  disabled?: boolean
  defaultValue?: boolean
  // -- Styling ---------------------------------------------------------------
  className?: string
  classNames?: ElementCheckboxClassNames
}

// --- Core render --------------------------------------------------------------

interface CheckboxCoreProps
  extends Omit<ElementCheckboxProps, "name" | "control" | "value" | "onChange" | "defaultValue"> {
  name?: string
  value: boolean
  onChange: (value: boolean) => void
  error?: FieldError
}

function CheckboxCore({
  name,
  value,
  onChange,
  onBlur,
  error,
  label,
  hint,
  required = false,
  disabled = false,
  className,
  classNames = {},
}: CheckboxCoreProps) {
  const hasError = !!error

  return (
    <div className={cn("flex flex-col gap-1.5", classNames.root, className)}>
      <div className={cn("flex items-center gap-2", classNames.row)}>
        <Checkbox
          id={name}
          checked={value}
          onCheckedChange={(checked) => onChange(checked === true)}
          onBlur={onBlur}
          disabled={disabled}
          aria-invalid={hasError}
          className={cn(classNames.checkbox)}
        />

        {label && (
          <div className="flex items-center gap-1.5">
            <label
              htmlFor={name}
              className={cn(
                "text-sm font-medium leading-none",
                hasError ? "text-destructive" : "text-foreground",
                disabled && "cursor-not-allowed opacity-50",
                classNames.label
              )}
            >
              {label}
              {required && (
                <span className={cn("mx-0.5 text-destructive", classNames.requiredMark)}>*</span>
              )}
            </label>
            {hint && <ElementLabelHint id={`${name}-hint`} text={hint} />}
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {hasError && (
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

// --- ElementCheckbox — dual-mode form wrapper ---------------------------------

export default function ElementCheckbox({
  name,
  control: controlProp,
  value: valueProp,
  onChange: onChangeProp,
  onBlur: onBlurProp,
  defaultValue = false,
  ...rest
}: ElementCheckboxProps) {
  const formCtx = useFormContext() as UseFormReturn | null
  const effectiveControl = controlProp ?? formCtx?.control

  if (name && effectiveControl) {
    return (
      <Controller
        name={name}
        control={effectiveControl}
        defaultValue={defaultValue}
        render={({ field, fieldState: { error } }) => (
          <CheckboxCore
            {...rest}
            name={name}
            value={!!field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={error}
          />
        )}
      />
    )
  }

  return (
    <CheckboxCore
      {...rest}
      name={name}
      value={valueProp ?? false}
      onChange={onChangeProp ?? (() => {})}
      onBlur={onBlurProp}
    />
  )
}
