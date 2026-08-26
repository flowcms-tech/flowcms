'use client'

import { Home, ChevronRight } from 'lucide-react'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'

interface FileManagerBreadcrumbProps {
  prefix: string
  onNavigate: (prefix: string) => void
}

export default function FileManagerBreadcrumb({ prefix, onNavigate }: FileManagerBreadcrumbProps) {
  const segments = prefix.split('/').filter(Boolean)

  return (
    <div className="flex items-center gap-1 text-sm">
      <button
        type="button"
        onClick={() => onNavigate('')}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Home"
      >
        <Home size={15} />
      </button>

      {segments.map((segment, index) => {
        const segmentPrefix = `${segments.slice(0, index + 1).join('/')}/`
        const isLast = index === segments.length - 1

        return (
          <div key={segmentPrefix} className="flex items-center gap-1">
            <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
            {isLast ? (
              <ElementBadge
                variant="info"
                className="cursor-pointer"
                onClick={() => onNavigate(segmentPrefix)}
              >
                {segment}
              </ElementBadge>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(segmentPrefix)}
                className="rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {segment}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
