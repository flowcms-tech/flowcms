"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import type { ClassValue } from "clsx"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

export interface ElementTabsItem {
  value: string
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  /** Shown as a small destructive count badge next to the label — e.g. the
   *  number of validation errors in that tab's fields. Hidden when 0/undefined. */
  errorCount?: number
}

export interface ElementTabsClassNames {
  root?: ClassValue
  list?: ClassValue
  trigger?: ClassValue
}

export interface ElementTabsProps {
  items: ElementTabsItem[]
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  className?: string
  classNames?: ElementTabsClassNames
  children: React.ReactNode
}

function ElementTabs({
  items,
  defaultValue,
  value,
  onValueChange,
  className,
  classNames = {},
  children,
}: ElementTabsProps) {
  return (
    <Tabs
      defaultValue={defaultValue ?? items[0]?.value}
      value={value}
      onValueChange={onValueChange}
      className={cn("flex flex-col gap-4", classNames.root, className)}
    >
      <TabsList className={cn(classNames.list)}>
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={cn(classNames.trigger)}
          >
            {item.icon && <span className="me-1.5 inline-flex items-center">{item.icon}</span>}
            {item.label}
            {!!item.errorCount && (
              <span className="ms-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive/15 px-1 text-[10px] font-semibold leading-none text-destructive dark:bg-destructive/25">
                {item.errorCount}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>

      {children}
    </Tabs>
  )
}

function ElementTabsContent({
  value,
  className,
  children,
}: {
  value: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <TabsContent value={value} className={className}>
      {children}
    </TabsContent>
  )
}

ElementTabs.Content = ElementTabsContent

export default ElementTabs
export { ElementTabsContent }
