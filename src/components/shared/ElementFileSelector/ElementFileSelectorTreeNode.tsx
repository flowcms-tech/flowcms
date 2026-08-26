'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, ChevronDown, Folder, Home } from 'lucide-react'
import { fetchFileSelectorDirectory } from './ElementFileSelector.api'

interface ElementFileSelectorTreeNodeProps {
  prefix: string
  name: string
  depth: number
  selectedPrefix: string
  onSelect: (prefix: string) => void
  defaultExpanded?: boolean
}

export default function ElementFileSelectorTreeNode({
  prefix,
  name,
  depth,
  selectedPrefix,
  onSelect,
  defaultExpanded = false,
}: ElementFileSelectorTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const isSelected = selectedPrefix === prefix

  const { data } = useQuery({
    queryKey: ['element-file-selector-dir', prefix],
    queryFn: () => fetchFileSelectorDirectory(prefix),
    enabled: isExpanded,
  })

  const childDirectories = data?.directories ?? []

  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded-md py-1.5 pe-1 text-sm cursor-pointer hover:bg-muted ${isSelected ? 'bg-muted font-medium' : ''}`}
        style={{ paddingInlineStart: `${depth * 16 + 8}px` }}
        onClick={() => { onSelect(prefix); setIsExpanded(true) }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded((prev) => !prev)
          }}
          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {prefix === ''
          ? <Home size={14} className="shrink-0 text-muted-foreground" />
          : <Folder size={14} className="shrink-0 text-muted-foreground" />}
        <span className="flex-1 truncate">{name}</span>
      </div>

      {isExpanded && childDirectories.map((childPrefix) => (
        <ElementFileSelectorTreeNode
          key={childPrefix}
          prefix={childPrefix}
          name={childPrefix.slice(prefix.length).replace(/\/$/, '')}
          depth={depth + 1}
          selectedPrefix={selectedPrefix}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
