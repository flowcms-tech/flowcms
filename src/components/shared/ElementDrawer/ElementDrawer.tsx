"use client"

import * as React from "react"
import { useEffect, useState, useCallback } from "react"
import { cva } from "class-variance-authority"
import { X, CheckCircle, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Drawer, DrawerContent } from "@/components/ui/drawer"
import type { ClassValue } from "clsx"

// --- Size variants ------------------------------------------------------------

const drawerSizeVariants = cva(
  "h-screen top-0 mt-0 rounded-none",
  {
    variants: {
      size: {
        sm: "w-[90vw] sm:w-[400px]",
        md: "w-[90vw] sm:w-[567px]",
        lg: "w-[90vw] sm:w-[920px]",
        xl: "w-[90vw] sm:w-[1200px]",
      },
      direction: {
        right: "right-0 left-auto",
        left: "left-0 right-auto",
      },
    },
    defaultVariants: { size: "sm", direction: "right" },
  }
)

// --- Types --------------------------------------------------------------------

export interface ElementDrawerClassNames {
  content?: ClassValue
  header?: ClassValue
  headerLabel?: ClassValue
  body?: ClassValue
  footer?: ClassValue
}

export interface ElementDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  headerLabel: string
  children: React.ReactNode
  size?: "sm" | "md" | "lg" | "xl"
  direction?: "left" | "right"
  /** Renders outside the scroll area — always visible at bottom */
  footer?: React.ReactNode
  /** Allow closing by clicking the backdrop. Default: false */
  closeOnOutsideClick?: boolean
  classNames?: ElementDrawerClassNames
}

// --- ElementDrawer ------------------------------------------------------------

export default function ElementDrawer({
  isOpen,
  setIsOpen,
  headerLabel,
  children,
  size = "sm",
  direction = "right",
  footer,
  closeOnOutsideClick = false,
  classNames,
}: ElementDrawerProps) {
  return (
    <Drawer
      direction={direction}
      open={isOpen}
      onOpenChange={(open) => { if (!open) setIsOpen(false) }}
      dismissible={closeOnOutsideClick}
    >
      <DrawerContent
        className={cn(drawerSizeVariants({ size, direction }), "shadow-2xl flex flex-col", classNames?.content)}
        onInteractOutside={(e) => { if (!closeOnOutsideClick) e.preventDefault() }}
      >
        {/* -- Header ---------------------------------------------------- */}
        <div
          className={cn(
            "flex shrink-0 items-center justify-between px-6 py-4",
            "bg-primary text-primary-foreground",
            classNames?.header
          )}
        >
          <span className={cn("font-medium text-sm", classNames?.headerLabel)}>
            {headerLabel}
          </span>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close drawer"
            className="rounded-md p-1 opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/50"
          >
            <X size={18} />
          </button>
        </div>

        {/* -- Body ------------------------------------------------------ */}
        <div
          className={cn(
            "flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4 styled-scrollbar",
            classNames?.body
          )}
        >
          {children}
        </div>

        {/* -- Footer (optional) ------------------------------------------ */}
        {footer && (
          <div
            className={cn(
              "shrink-0 border-t border-border bg-background",
              classNames?.footer
            )}
          >
            {footer}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  )
}

// --- ElementDrawerFooter ------------------------------------------------------
// Convenience wrapper — pass as the `footer` prop on ElementDrawer.

export function ElementDrawerFooter({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-3 px-6 py-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// --- ElementDrawerInlineFeedback ----------------------------------------------

type FeedbackVariant = "success" | "error"

const feedbackStyles: Record<FeedbackVariant, { bg: string; border: string; text: string; icon: string }> = {
  success: {
    bg: "bg-success/5",
    border: "border-success/30",
    text: "text-success",
    icon: "text-success",
  },
  error: {
    bg: "bg-destructive/5",
    border: "border-destructive/30",
    text: "text-destructive",
    icon: "text-destructive",
  },
}

export interface ElementDrawerInlineFeedbackProps {
  message: string | null
  variant: FeedbackVariant
  /** Auto-dismiss ms. Default: 3000 for success, 0 (no auto-dismiss) for error. */
  duration?: number
  onDismiss?: () => void
}

export function ElementDrawerInlineFeedback({
  message,
  variant,
  duration,
  onDismiss,
}: ElementDrawerInlineFeedbackProps) {
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null)
  const visible = !!message && message !== dismissedMessage

  const dismiss = useCallback(() => {
    setDismissedMessage(message)
    onDismiss?.()
  }, [message, onDismiss])

  useEffect(() => {
    if (!message) return
    const ms = duration ?? (variant === "success" ? 3000 : 0)
    if (ms <= 0) return
    const t = setTimeout(dismiss, ms)
    return () => clearTimeout(t)
  }, [message, variant, duration, dismiss])

  if (!visible) return null

  const styles = feedbackStyles[variant]
  const Icon = variant === "success" ? CheckCircle : AlertCircle

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-4 py-2.5",
        "animate-in fade-in slide-in-from-top-1 duration-200",
        styles.bg,
        styles.border
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", styles.icon)} />
      <p className={cn("flex-1 text-sm font-medium", styles.text)}>{message}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className={cn(
          "shrink-0 rounded-md p-0.5 transition-colors hover:bg-black/5",
          styles.text
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
