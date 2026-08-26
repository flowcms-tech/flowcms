"use client"

import * as React from "react"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ClassValue } from "clsx"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export interface ElementLabelHintProps {
  /** The short description shown in the tooltip. */
  text: string
  /**
   * Id for the visually hidden copy of `text`. Fields point their
   * `aria-describedby` at this, since the tooltip itself is portalled and
   * only exists in the DOM while open.
   */
  id?: string
  /** Which side the tooltip opens on. @default "top" */
  side?: "top" | "right" | "bottom" | "left"
  className?: ClassValue
  classNames?: {
    trigger?: ClassValue
    content?: ClassValue
  }
}

/**
 * A small info icon that sits next to a field label and reveals a one-line
 * description on hover, focus, or tap.
 *
 * The root layout already mounts `<TooltipProvider>`, so this renders anywhere
 * inside the app without extra setup. Open state is controlled so a tap works
 * on touch devices, where hover never fires.
 */
export default function ElementLabelHint({
  text,
  id,
  side = "top",
  className,
  classNames = {},
}: ElementLabelHintProps) {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <>
      {id && (
        <span id={id} className="sr-only">
          {text}
        </span>
      )}
      <Tooltip open={isOpen} onOpenChange={setIsOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="More information"
            onClick={() => setIsOpen((open) => !open)}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground",
              "transition-colors hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              classNames.trigger,
              className
            )}
          >
            <Info size={14} aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={6} className={cn(classNames.content)}>
          {text}
        </TooltipContent>
      </Tooltip>
    </>
  )
}
