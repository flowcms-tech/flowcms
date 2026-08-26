"use client"

import { cn } from "@/lib/utils"
import type { ClassValue } from "clsx"

interface ValidationBoxProps {
  messages: string[]
  className?: ClassValue
}

export default function ValidationBox({ messages, className }: ValidationBoxProps) {
  if (messages.length === 0) return null

  return (
    <div
      className={cn(
        "rounded-lg border border-destructive/30 bg-destructive-light px-3 py-2.5",
        className
      )}
    >
      <div className="flex flex-col gap-1">
        {messages.map((msg, i) => (
          <p key={i} className="text-xs font-semibold text-destructive">
            - {msg}
          </p>
        ))}
      </div>
    </div>
  )
}
