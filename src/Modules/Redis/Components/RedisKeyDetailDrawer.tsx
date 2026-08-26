'use client'

import { useQuery } from '@tanstack/react-query'
import ElementDrawer from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import { RedisServices } from '../Services/RedisServices'

function formatTtl(ttlSeconds: number | null): string {
  if (ttlSeconds === null) return 'No expiry'
  if (ttlSeconds < 60) return `${ttlSeconds}s`
  if (ttlSeconds < 3600) return `${Math.round(ttlSeconds / 60)}m`
  return `${Math.round(ttlSeconds / 3600)}h`
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function RedisKeyDetailDrawer({
  redisKey,
  onClose,
}: {
  redisKey: string | null
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['redis-key-detail', redisKey],
    queryFn: () => RedisServices.getKeyDetail(redisKey!),
    enabled: !!redisKey,
  })

  return (
    <ElementDrawer
      isOpen={redisKey !== null}
      setIsOpen={(open) => { if (!open) onClose() }}
      headerLabel="Key Detail"
      direction="left"
      size="lg"
    >
      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Key</p>
            <p className="break-all font-mono text-sm">{data.key}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <ElementBadge variant="info">{data.type}</ElementBadge>
            <ElementBadge variant={data.ttlSeconds === null ? 'muted' : 'warning'}>
              {formatTtl(data.ttlSeconds)}
            </ElementBadge>
            <ElementBadge variant="outline">{formatBytes(data.approxBytes)}</ElementBadge>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Value</p>
            <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
              {JSON.stringify(data.value, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </ElementDrawer>
  )
}
