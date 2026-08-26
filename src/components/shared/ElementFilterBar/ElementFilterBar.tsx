'use client'

import * as React from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { ClassValue } from 'clsx'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'

export interface ElementFilterBarClassNames {
  root?: ClassValue
  trigger?: ClassValue
  content?: ClassValue
}

export interface ElementFilterBarProps {
  /** Filter controls (search input, selects, date pickers, ...) */
  children: React.ReactNode
  /** Label on the mobile trigger button. Default: 'Filters' */
  triggerLabel?: string
  /** Number of currently active filters — shown as a badge on the mobile trigger button. */
  activeCount?: number
  classNames?: ElementFilterBarClassNames
}

/**
 * Wraps a row of table filters. On desktop (>= md / 768px) it renders the
 * filters inline, unchanged. Below that breakpoint it collapses them behind
 * a single "Filters" button that opens the same controls in a popover
 * anchored right under the button — no full-screen takeover, closes on
 * outside click or selection, stays in place. Matches the sidebar's own
 * mobile breakpoint (`src/hooks/use-mobile.ts`).
 *
 * Each filter field is still responsible for its own width (e.g.
 * `classNames={{ root: 'w-full md:w-44' }}`) so it stacks full-width inside
 * the popover and keeps its fixed desktop width inline.
 */
export default function ElementFilterBar({ children, triggerLabel = 'Filters', activeCount = 0, classNames }: ElementFilterBarProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = React.useState(false)

  if (!isMobile) {
    return (
      <div className={cn('flex flex-wrap items-center gap-2', classNames?.root)}>
        {children}
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ElementButton
          type="button"
          variant="outline"
          size="default"
          className={cn('relative flex items-center gap-1.5', classNames?.trigger)}
        >
          <SlidersHorizontal size={14} />
          {triggerLabel}
          {activeCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {activeCount}
            </span>
          )}
        </ElementButton>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        className={cn('w-[min(22rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto p-4', classNames?.content)}
      >
        <div className="flex flex-col gap-3">
          {children}
        </div>
      </PopoverContent>
    </Popover>
  )
}
