"use client"

import * as React from "react"
import { cva } from "class-variance-authority"
import { AlertTriangle, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Dialog as DialogPrimitive } from "radix-ui"
import ElementButton from "@/components/shared/ElementButton/ElementButton"
import type { ClassValue } from "clsx"

// --- Size variants ------------------------------------------------------------

const modalSizeVariants = cva("w-[90vw]", {
  variants: {
    size: {
      sm: "sm:w-[568px]",
      md: "md:w-[768px]",
      lg: "lg:w-[920px]",
    },
  },
  defaultVariants: { size: "sm" },
})

const modalHeaderVariants = cva(
  "relative flex shrink-0 items-center gap-3 px-5 h-16 text-sm font-medium",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        danger:  "bg-destructive text-white",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

// --- Types --------------------------------------------------------------------

export interface ElementModalClassNames {
  content?:      ClassValue
  header?:       ClassValue
  headerLabel?:  ClassValue
  icon?:         ClassValue
  closeButton?:  ClassValue
  body?:         ClassValue
  footer?:       ClassValue
}

export interface ElementModalProps {
  isOpen:        boolean
  onClose?:      (open: boolean) => void
  title:         React.ReactNode
  children:      React.ReactNode
  size?:         "sm" | "md" | "lg"
  variant?:      "default" | "danger"
  titleIcon?:    React.ReactNode | false
  trigger?:      React.ReactNode
  showHeader?:   boolean
  /** Renders outside the scroll area — always visible at the bottom */
  footer?:       React.ReactNode
  /** Allow closing by clicking the backdrop. Default: false */
  closeOnOutsideClick?: boolean
  classNames?:   ElementModalClassNames
}

// --- ElementModalFooter -------------------------------------------------------

export function ElementModalFooter({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-background",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// --- ElementModal (main) ------------------------------------------------------

function ElementModalRoot({
  isOpen,
  onClose,
  title,
  children,
  size = "sm",
  variant = "default",
  titleIcon,
  trigger,
  showHeader = true,
  footer,
  closeOnOutsideClick = false,
  classNames,
}: ElementModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}

      <DialogContent
        aria-describedby={undefined}
        onInteractOutside={(e) => { if (!closeOnOutsideClick) e.preventDefault() }}
        className={cn(
          "p-0 gap-0 flex flex-col overflow-hidden max-h-[90vh]",
          modalSizeVariants({ size }),
          classNames?.content
        )}
      >
        {/* Close button — left side in RTL */}
        <DialogClose asChild>
          <button
            aria-label="Close"
            className={cn(
              "cursor-pointer absolute left-4 top-[22px] z-10 rounded-md p-0.5 opacity-80 transition-opacity hover:opacity-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/50",
              showHeader ? "text-primary-foreground" : "text-foreground",
              classNames?.closeButton
            )}
          >
            <X size={18} />
          </button>
        </DialogClose>

        {/* Header — title starts from right in RTL */}
        {showHeader && (
          <DialogTitle
            className={cn(
              modalHeaderVariants({ variant }),
              "pl-10",
              classNames?.header
            )}
          >
            {titleIcon && (
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20",
                  classNames?.icon
                )}
              >
                {titleIcon}
              </span>
            )}
            <span className={cn("font-medium", classNames?.headerLabel)}>
              {title}
            </span>
          </DialogTitle>
        )}

        {/* Body */}
        <div
          className={cn(
            "flex-1 min-h-0 overflow-y-auto p-6 styled-scrollbar",
            footer ? "" : "pb-6",
            classNames?.body
          )}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className={cn("shrink-0", classNames?.footer)}>
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// --- ElementModal.Confirm -----------------------------------------------------

export interface ElementModalConfirmProps {
  isOpen:           boolean
  onClose:          (open: boolean) => void
  title?:           string
  description?:     React.ReactNode
  children?:        React.ReactNode
  onConfirm:        () => void | Promise<void>
  isLoading?:       boolean
  confirmText?:     string
  cancelText?:      string
  disabledConfirm?: boolean
  /** "danger" = red icon + destructive button, "warning" = yellow icon, "default" = primary */
  variant?:         "danger" | "warning" | "default"
  /** Custom icon — overrides variant default */
  icon?:            React.ReactNode
  classNames?: {
    content?:    ClassValue
    iconWrapper?: ClassValue
    title?:      ClassValue
    description?: ClassValue
  }
}

const CONFIRM_ICON_STYLES = {
  danger:  { wrapper: "bg-destructive/10", icon: <Trash2 size={20} className="text-destructive" /> },
  warning: { wrapper: "bg-warning-light", icon: <AlertTriangle size={20} className="text-warning" /> },
  default: { wrapper: "bg-primary/10", icon: <AlertTriangle size={20} className="text-primary" /> },
}

function ModalConfirm({
  isOpen,
  onClose,
  title = "Are you sure?",
  description,
  children,
  onConfirm,
  isLoading = false,
  confirmText = "Confirm",
  cancelText = "Cancel",
  disabledConfirm = false,
  variant = "danger",
  icon,
  classNames,
}: ElementModalConfirmProps) {
  const [busy, setBusy] = React.useState(false)
  const iconStyle = CONFIRM_ICON_STYLES[variant]

  async function handleConfirm() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          "p-0 gap-0 overflow-hidden w-[90vw] sm:w-[440px]",
          classNames?.content
        )}
      >
        {/* Body */}
        <div className="flex gap-4 px-6 pt-6 pb-4">
          <div
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
              iconStyle.wrapper,
              classNames?.iconWrapper
            )}
          >
            {icon ?? iconStyle.icon}
          </div>
          <div className="flex flex-col gap-1.5 pt-0.5">
            <DialogTitle
              className={cn("text-base font-semibold text-foreground", classNames?.title)}
            >
              {title}
            </DialogTitle>
            {description && (
              <DialogPrimitive.Description
                className={cn("text-sm text-muted-foreground", classNames?.description)}
              >
                {description}
              </DialogPrimitive.Description>
            )}
            {children && (
              <div className="mt-1 text-sm text-muted-foreground">{children}</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border bg-background px-6 py-4">
          <ElementButton
            variant="cancel"
            size="default"
            onClick={() => onClose(false)}
            disabled={isLoading || busy}
          >
            {cancelText}
          </ElementButton>
          <ElementButton
            variant={variant === "danger" ? "destructive" : "primary"}
            size="default"
            isLoading={isLoading || busy}
            disabled={disabledConfirm}
            onClick={handleConfirm}
          >
            {confirmText}
          </ElementButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// --- ElementModal.Warning -----------------------------------------------------

const warningBorderVariants = cva("border-l-4", {
  variants: {
    variant: {
      danger:    "border-l-destructive",
      primary:   "border-l-primary",
      secondary: "border-l-secondary-foreground",
    },
  },
  defaultVariants: { variant: "danger" },
})

export interface ElementModalWarningProps {
  isOpen:               boolean
  onClose:              (open: boolean) => void
  title:                string
  children:             React.ReactNode
  variant?:             "danger" | "primary" | "secondary"
  closeText?:           string
  classNames?: {
    content?: ClassValue
    title?:   ClassValue
    body?:    ClassValue
    icon?:    ClassValue
  }
}

function ModalWarning({
  isOpen,
  onClose,
  title,
  children,
  variant = "danger",
  closeText = "Close",
  classNames,
}: ElementModalWarningProps) {
  const iconColor =
    variant === "danger"   ? "text-destructive" :
    variant === "primary"  ? "text-primary"      :
                             "text-secondary-foreground"

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          "p-0 gap-0 overflow-hidden w-[90vw] sm:w-[512px]",
          warningBorderVariants({ variant }),
          classNames?.content
        )}
      >
        <div className="p-6 pb-4">
          <div className="flex gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted",
                classNames?.icon
              )}
            >
              <AlertTriangle size={20} className={iconColor} />
            </div>
            <div className="flex-1">
              <DialogTitle
                className={cn("text-base font-semibold text-foreground mb-2", classNames?.title)}
              >
                {title}
              </DialogTitle>
              <div className={cn("text-sm text-muted-foreground leading-relaxed", classNames?.body)}>
                {children}
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end border-t border-border bg-background px-6 py-4">
          <ElementButton variant="cancel" size="sm" onClick={() => onClose(false)}>
            {closeText}
          </ElementButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// --- Public export ------------------------------------------------------------

const ElementModal = Object.assign(ElementModalRoot, {
  /** Confirmation / delete dialog */
  Confirm: ModalConfirm,
  /** Warning / info dialog with colored left border */
  Warning: ModalWarning,
  /** Footer bar — use as the `footer` prop value */
  Footer: ElementModalFooter,
})

export default ElementModal
