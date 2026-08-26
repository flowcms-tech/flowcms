'use client'

import { useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Trash2, RefreshCw, Eye } from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { RedisServices } from './Services/RedisServices'
import RedisKeyDetailDrawer from './Components/RedisKeyDetailDrawer'
import { CACHE_PREFIX } from './Values/constants'
import type { KeySummary } from './Types'

interface SearchForm {
  pattern: string
}

function formatTtl(ttlSeconds: number | null): string {
  if (ttlSeconds === null) return 'No expiry'
  if (ttlSeconds < 60) return `${ttlSeconds}s`
  if (ttlSeconds < 3600) return `${Math.round(ttlSeconds / 60)}m`
  return `${Math.round(ttlSeconds / 3600)}h`
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-background p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  )
}

export default function RedisModule() {
  const queryClient = useQueryClient()
  const [pattern, setPattern] = useState('*')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [isFlushConfirmOpen, setIsFlushConfirmOpen] = useState(false)
  const [isFlushing, setIsFlushing] = useState(false)

  const methods = useForm<SearchForm>({ defaultValues: { pattern: '*' } })

  const { data: status, isLoading: isStatusLoading } = useQuery({
    queryKey: ['redis-status'],
    queryFn: RedisServices.status,
    // A monitoring screen that never refreshes itself isn't monitoring —
    // this is the one query in the admin panel that's meant to poll.
    refetchInterval: 10_000,
  })

  const { data: page, isLoading: isKeysLoading } = useQuery({
    queryKey: ['redis-keys', pattern],
    queryFn: () => RedisServices.scanKeys(pattern, '0', 100),
    enabled: status?.connected ?? false,
  })

  const invalidateKeys = () => queryClient.invalidateQueries({ queryKey: ['redis-keys'] })

  const handleSearch = (values: SearchForm) => {
    setPattern(values.pattern.trim() || '*')
  }

  const handleDelete = async (key: string) => {
    await RedisServices.deleteKey(key)
    await invalidateKeys()
  }

  const handleFlush = async () => {
    setIsFlushing(true)
    try {
      await RedisServices.flush()
      await invalidateKeys()
      await queryClient.invalidateQueries({ queryKey: ['redis-status'] })
    } catch {
      return
    } finally {
      setIsFlushing(false)
    }
    setIsFlushConfirmOpen(false)
  }

  const columns: ExtendedColumnDef<KeySummary>[] = [
    {
      id: 'key',
      accessorKey: 'key',
      header: 'Key',
      cell: ({ getValue }) => (
        <span className="break-all font-mono text-xs">{getValue() as string}</span>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => <ElementBadge variant="info">{row.original.type}</ElementBadge>,
    },
    {
      id: 'ttl',
      header: 'TTL',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{formatTtl(row.original.ttlSeconds)}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const isOwnKey = row.original.key.startsWith(CACHE_PREFIX)
        return (
          <div className="flex items-center justify-end gap-1">
            <ElementTableButton.detail
              title="View value"
              icon={<Eye size={13} />}
              onClick={() => setSelectedKey(row.original.key)}
            />
            {isOwnKey && (
              <ElementTableButton.delete
                title="Delete key"
                onClick={() => handleDelete(row.original.key)}
              />
            )}
          </div>
        )
      },
    },
  ]

  const header = (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">Redis Cache</p>
          <p className="text-xs text-muted-foreground">
            Live status of this app&apos;s cache layer, and a browser for whatever&apos;s
            actually stored in it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <ElementBadge variant={status.connected ? 'success' : 'destructive'}>
              {status.connected ? 'Connected' : 'Disconnected'}
            </ElementBadge>
          )}
          <ElementButton
            size="sm"
            variant="outline"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['redis-status'] })}
          >
            <RefreshCw size={14} />
            Refresh
          </ElementButton>
          <ElementButton
            size="sm"
            variant="cancel"
            onClick={() => setIsFlushConfirmOpen(true)}
            disabled={!status?.connected}
          >
            <Trash2 size={14} />
            Flush App Cache
          </ElementButton>
        </div>
      </div>

      {status?.connected && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <StatCard label="Latency" value={status.latencyMs !== null ? `${status.latencyMs}ms` : '—'} />
          <StatCard label="Used Memory" value={status.usedMemoryHuman ?? '—'} />
          <StatCard
            label="Uptime"
            value={status.uptimeSeconds !== null ? `${Math.round(status.uptimeSeconds / 3600)}h` : '—'}
          />
          <StatCard label="Clients" value={status.connectedClients?.toString() ?? '—'} />
          <StatCard
            label="Hit Rate"
            value={status.hitRatePercent !== null ? `${status.hitRatePercent}%` : '—'}
          />
          <StatCard label="Total Keys" value={status.dbSize?.toString() ?? '—'} />
          <StatCard label="App Keys" value={status.appKeyCount?.toString() ?? '—'} />
        </div>
      )}

      {!isStatusLoading && !status?.connected && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Redis isn&apos;t reachable. Caching is skipped everywhere it&apos;s used — every
          admin screen falls back to reading straight from the database, just slower.
        </div>
      )}

      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(handleSearch)} className="flex items-end gap-2">
          <ElementInput
            name="pattern"
            label="Filter by pattern"
            placeholder="flowcms:cache:blog-posts:*"
            startIcon={<Search size={15} />}
            hint={`Redis glob syntax. Try "${CACHE_PREFIX}*" for just this app's cache, or "*" for everything.`}
            classNames={{ root: 'w-full max-w-md' }}
          />
          <ElementButton type="submit" size="default">
            Search
          </ElementButton>
        </form>
      </FormProvider>
    </div>
  )

  return (
    <>
      <RedisKeyDetailDrawer redisKey={selectedKey} onClose={() => setSelectedKey(null)} />

      <ElementModal.Confirm
        isOpen={isFlushConfirmOpen}
        onClose={(v) => { if (!v) setIsFlushConfirmOpen(false) }}
        variant="danger"
        title="Flush App Cache"
        description={`Delete every cached key under "${CACHE_PREFIX}"? Nothing is lost — each one just repopulates from the database on its next read. Only affects this app's own keys, never anything else sharing this Redis instance.`}
        confirmText="Flush Cache"
        cancelText="Cancel"
        isLoading={isFlushing}
        onConfirm={handleFlush}
      />

      <ElementTable<KeySummary>
        columns={columns}
        data={page?.keys ?? []}
        loading={isKeysLoading}
        loadingRows={5}
        headerContent={header}
        emptyContent={
          <p>
            {status?.connected ? 'No keys match that pattern.' : 'Connect Redis to browse keys.'}
          </p>
        }
      />
    </>
  )
}
