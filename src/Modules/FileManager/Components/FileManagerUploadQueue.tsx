'use client'

import { Check, X } from 'lucide-react'
import { Progress } from '@/components/ui/progress'

export interface UploadQueueItem {
  id: string
  name: string
  progress: number
  status: 'uploading' | 'done' | 'error'
}

interface FileManagerUploadQueueProps {
  items: UploadQueueItem[]
}

export default function FileManagerUploadQueue({ items }: FileManagerUploadQueueProps) {
  if (items.length === 0) return null

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3">
          <span className="w-40 shrink-0 truncate text-sm" title={item.name}>
            {item.name}
          </span>
          <Progress
            value={item.status === 'error' ? 100 : item.progress}
            className={item.status === 'error' ? '[&>div]:bg-destructive' : undefined}
          />
          <span className="flex w-14 shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground">
            {item.status === 'error' ? (
              <>
                <X size={12} className="text-destructive" />
                Failed
              </>
            ) : item.status === 'done' ? (
              <>
                <Check size={12} className="text-success" />
                Done
              </>
            ) : (
              `${item.progress}%`
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
