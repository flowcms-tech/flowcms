'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import PageProfileModule from './PageProfileModule'

interface PageLookupModuleProps {
  initialUrl?: string
}

export default function PageLookupModule({ initialUrl }: PageLookupModuleProps) {
  const [input, setInput] = useState(initialUrl ?? '')
  const [lookupUrl, setLookupUrl] = useState(initialUrl ?? '')

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Page Lookup</h1>
        <p className="text-sm text-muted-foreground">
          Look up any URL&apos;s profile — a known post pulls up its full profile, an unknown one
          shows whatever can be resolved on the fly.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-4">
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && input.trim()) setLookupUrl(input.trim())
          }}
          placeholder="/blog/some-post or a full URL"
          className="h-9 min-w-[280px] flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
        />
        <ElementButton size="sm" onClick={() => input.trim() && setLookupUrl(input.trim())}>
          <Search size={14} />
          Look up
        </ElementButton>
      </div>

      {lookupUrl && <PageProfileModule url={lookupUrl} />}
    </div>
  )
}
