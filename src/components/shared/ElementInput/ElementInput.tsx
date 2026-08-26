"use client";

import { type ReactNode, useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Eye, EyeOff, X } from "lucide-react";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import ElementLabelHint from "@/components/shared/ElementLabelHint/ElementLabelHint";

type InputType =
  | "text"
  | "password"
  | "tel"
  | "email"
  | "number"
  | "search"
  | "url"
  | "date"
  | "time"
  | "datetime-local";

type ErrorVariant = "default" | "boxBelow";

interface ElementInputClassNames {
  root?: string;
  label?: string;
  requiredMark?: string;
  inputWrapper?: string;
  input?: string;
  eyeButton?: string;
  error?: string;
  hint?: string;
}

interface ElementInputProps {
  name: string;
  label?: string;
  placeholder?: string;
  type?: InputType;
  disabled?: boolean;
  classNames?: ElementInputClassNames;
  hint?: string;
  required?: boolean;
  defaultValue?: string;
  errorVariant?: ErrorVariant;
  maxLength?: number;
  startIcon?: ReactNode;
  clearable?: boolean;
  commaNumber?: boolean;
  dir?: "ltr" | "rtl" | "auto";
  startContent?: ReactNode;
  endContent?: ReactNode;
  autoComplete?: string;
  preventAutofill?: boolean;
}

function formatComma(rawValue: string | number | undefined | null): string {
  const digits = String(rawValue ?? "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
}

export default function ElementInput({
  name,
  label,
  placeholder,
  type = "text",
  disabled = false,
  classNames = {},
  hint,
  required = false,
  defaultValue = "",
  errorVariant = "default",
  maxLength,
  startIcon,
  clearable = false,
  commaNumber = false,
  dir,
  startContent,
  endContent,
  autoComplete,
  preventAutofill = false,
}: ElementInputProps) {
  const { control } = useFormContext();
  const [showPassword, setShowPassword] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(preventAutofill);

  const isPassword = type === "password";
  const resolvedType = isPassword ? (showPassword ? "text" : "password") : type;

  return (
    <Controller
      name={name}
      control={control}
      defaultValue={defaultValue}
      render={({ field, fieldState: { error } }) => {
        const displayValue = commaNumber ? formatComma(field.value) : field.value;

        const handleChange = commaNumber
          ? (e: React.ChangeEvent<HTMLInputElement>) => {
              const raw = e.target.value.replace(/[^0-9]/g, "");
              field.onChange(raw === "" ? "" : Number(raw));
            }
          : type === "tel"
            ? (e: React.ChangeEvent<HTMLInputElement>) =>
                field.onChange(e.target.value.replace(/\D/g, "").slice(0, maxLength ?? 11))
            : field.onChange;

        const resolvedInputMode =
          commaNumber ? "numeric"
          : type === "tel" ? "numeric"
          : type === "number" ? "numeric"
          : undefined;

        return (
          <div className={clsx("flex flex-col gap-1.5", classNames.root)}>
            {label && (
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor={name}
                  className={clsx(
                    "text-sm font-medium leading-none",
                    error ? "text-destructive" : "text-foreground",
                    disabled && "opacity-50 cursor-not-allowed",
                    classNames.label
                  )}
                >
                  {label}
                  {required && (
                    <span className={clsx("text-destructive mx-0.5", classNames.requiredMark)}>
                      *
                    </span>
                  )}
                </label>
                {hint && <ElementLabelHint id={`${name}-hint`} text={hint} />}
              </div>
            )}

            <div>
              {/* Shared border container when addons present */}
              {(startContent || endContent) ? (
                <div className={clsx(
                  "flex items-stretch overflow-hidden rounded-lg border transition-colors",
                  errorVariant === "boxBelow" && error && "rounded-b-none",
                  error ? "border-destructive" : "border-input",
                  classNames.inputWrapper
                )}>
                  {startContent && (
                    <div className={clsx("flex shrink-0 items-center border-e", error ? "border-e-destructive" : "border-e-input")}>
                      {startContent}
                    </div>
                  )}
                  <div className="relative flex-1">
                    {startIcon && (
                      <span className="absolute inset-y-0 start-0 flex items-center ps-3 text-muted-foreground pointer-events-none">
                        {startIcon}
                      </span>
                    )}
                    <Input
                      {...field}
                      id={name}
                      type={commaNumber ? "text" : resolvedType}
                      value={displayValue}
                      onChange={handleChange}
                      placeholder={placeholder}
                      disabled={disabled}
                      dir={commaNumber ? "ltr" : dir}
                      aria-invalid={!!error}
                      aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
                      inputMode={resolvedInputMode}
                      maxLength={type === "tel" ? (maxLength ?? 11) : maxLength}
                      autoComplete={autoComplete}
                      readOnly={isReadOnly}
                      onFocus={() => { if (isReadOnly) setIsReadOnly(false) }}
                      className={clsx(
                        "h-10 border-0 rounded-none focus-visible:ring-0 aria-invalid:ring-0",
                        startIcon && "ps-9",
                        isPassword && "pe-10",
                        clearable && field.value && "pe-9",
                        classNames.input
                      )}
                    />
                    {isPassword && (
                      <button type="button" tabIndex={-1} onClick={() => setShowPassword((p) => !p)} disabled={disabled}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className={clsx("absolute inset-y-0 end-0 flex items-center pe-3 text-muted-foreground hover:text-foreground transition-colors", disabled && "pointer-events-none opacity-50", classNames.eyeButton)}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    )}
                    {clearable && !isPassword && field.value && (
                      <button type="button" tabIndex={-1} onClick={() => field.onChange("")} disabled={disabled}
                        className={clsx("absolute inset-y-0 end-0 flex items-center pe-3 text-muted-foreground hover:text-foreground transition-colors", disabled && "pointer-events-none opacity-50")}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  {endContent && (
                    <div className={clsx("flex shrink-0 items-center border-s", error ? "border-s-destructive" : "border-s-input")}>
                      {endContent}
                    </div>
                  )}
                </div>
              ) : (
                <div className={clsx("relative", classNames.inputWrapper)}>
                  {startIcon && (
                    <span className="absolute inset-y-0 start-0 flex items-center ps-3 text-muted-foreground pointer-events-none">
                      {startIcon}
                    </span>
                  )}
                  <Input
                    {...field}
                    id={name}
                    type={commaNumber ? "text" : resolvedType}
                    value={displayValue}
                    onChange={handleChange}
                    placeholder={placeholder}
                    disabled={disabled}
                    dir={commaNumber ? "ltr" : dir}
                    aria-invalid={!!error}
                    aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
                    inputMode={resolvedInputMode}
                    maxLength={type === "tel" ? (maxLength ?? 11) : maxLength}
                    className={clsx(
                      "focus-visible:ring-0 aria-invalid:ring-0 h-10",
                      errorVariant === "boxBelow" && error && "rounded-b-none border-b-0",
                      startIcon && "ps-9",
                      isPassword && "pe-10",
                      clearable && field.value && "pe-9",
                      classNames.input
                    )}
                  />
                  {isPassword && (
                    <button type="button" tabIndex={-1} onClick={() => setShowPassword((p) => !p)} disabled={disabled}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className={clsx("absolute inset-y-0 end-0 flex items-center pe-3 text-muted-foreground hover:text-foreground transition-colors", disabled && "pointer-events-none opacity-50", classNames.eyeButton)}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  )}
                  {clearable && !isPassword && field.value && (
                    <button type="button" tabIndex={-1} onClick={() => field.onChange("")} disabled={disabled}
                      className={clsx("absolute inset-y-0 end-0 flex items-center pe-3 text-muted-foreground hover:text-foreground transition-colors", disabled && "pointer-events-none opacity-50")}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              )}

              <AnimatePresence initial={false}>
                {errorVariant === "boxBelow" && error && (
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
                      className={clsx(
                        "text-sm text-destructive",
                        "border border-destructive rounded-b-lg px-2.5 py-2 bg-destructive/5",
                        classNames.error
                      )}
                    >
                      {error.message}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <AnimatePresence initial={false}>
              {errorVariant === "default" && error && (
                <motion.p
                  id={`${name}-error`}
                  role="alert"
                  key="default-error"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={clsx("text-sm text-destructive", classNames.error)}
                >
                  {error.message}
                </motion.p>
              )}
            </AnimatePresence>

          </div>
        );
      }}
    />
  );
}
