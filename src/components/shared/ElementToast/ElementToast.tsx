"use client"

import * as React from "react"
import { toast, type ExternalToast, type ToasterProps } from "sonner"
import { Toaster } from "@/components/ui/sonner"

// --- Component ----------------------------------------------------------------
// Place <ElementToast /> (or <ElementToast>{children}</ElementToast>) once in
// your root layout. All ElementToast.* calls will render into it.

interface ElementToastRootProps extends ToasterProps {
  children?: React.ReactNode
}

function ElementToastRoot({
  children,
  position = "top-right",
  richColors = true,
  expand = false,
  visibleToasts = 4,
  closeButton = true,
  ...props
}: ElementToastRootProps) {
  return (
    <>
      {children}
      <Toaster
        position={position}
        richColors={richColors}
        expand={expand}
        visibleToasts={visibleToasts}
        closeButton={closeButton}
        {...props}
      />
    </>
  )
}

// --- Static methods -----------------------------------------------------------

const ElementToast = Object.assign(ElementToastRoot, {
  /** Show a success toast */
  success(message: React.ReactNode, options?: ExternalToast) {
    return toast.success(message, options)
  },

  /** Show an error toast */
  error(message: React.ReactNode, options?: ExternalToast) {
    return toast.error(message, options)
  },

  /** Show an info toast */
  info(message: React.ReactNode, options?: ExternalToast) {
    return toast.info(message, options)
  },

  /** Show a warning toast */
  warning(message: React.ReactNode, options?: ExternalToast) {
    return toast.warning(message, options)
  },

  /** Show a loading toast — update it later with ElementToast.success/error passing the returned id */
  loading(message: React.ReactNode, options?: ExternalToast) {
    return toast.loading(message, options)
  },

  /** Show a plain toast */
  message(message: React.ReactNode, options?: ExternalToast) {
    return toast(message, options)
  },

  /**
   * Show a promise toast that updates automatically.
   * @example
   * ElementToast.promise(fetchData(), {
   *   loading: "Saving...",
   *   success: "Saved!",
   *   error: "Failed to save",
   * })
   */
  promise: toast.promise.bind(toast) as typeof toast.promise,

  /** Render a fully custom toast */
  custom: toast.custom.bind(toast) as typeof toast.custom,

  /** Dismiss one toast by id, or all toasts if no id is given */
  dismiss(id?: string | number) {
    toast.dismiss(id)
  },
})

export default ElementToast
