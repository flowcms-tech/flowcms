'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PlugZap, Send, Bot } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import PaginatedDimensionTable from '@/Modules/SearchConsole/Components/PaginatedDimensionTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { UrlSubmissionServices } from './Services/UrlSubmissionServices'
import type { BingFetchedUrl } from './Types/urlSubmission'

const QUERY_KEY = ['bing-url-submission']

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
      <PlugZap size={22} className="text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs leading-snug text-muted-foreground">{children}</p>
    </div>
  )
}

function QuotaTile({ label, quota }: { label: string; quota: { dailyQuota: number; monthlyQuota: number } | null }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 shadow-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-2xl font-semibold tabular-nums">{quota?.dailyQuota ?? '—'}</span>
        <span className="text-xs text-muted-foreground">per day</span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{quota?.monthlyQuota ?? '—'} per month</p>
    </div>
  )
}

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { message?: string | string[] } } }
  const raw = axiosErr.response?.data?.message
  return Array.isArray(raw) ? raw.join(', ') : raw || fallback
}

export default function UrlSubmissionModule() {
  const queryClient = useQueryClient()

  const [singleUrl, setSingleUrl] = useState('')
  const [isSubmittingSingle, setIsSubmittingSingle] = useState(false)
  const [singleError, setSingleError] = useState<string | null>(null)

  const [batchInput, setBatchInput] = useState('')
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)

  const [fetchUrlInput, setFetchUrlInput] = useState('')
  const [isFetching, setIsFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => UrlSubmissionServices.urlSubmission(),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY })

  const batchUrls = batchInput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const handleSubmitSingle = async () => {
    if (!singleUrl.trim()) return
    setIsSubmittingSingle(true)
    setSingleError(null)
    try {
      await UrlSubmissionServices.submitUrl(singleUrl.trim())
      setSingleUrl('')
      refresh()
    } catch (err) {
      setSingleError(extractErrorMessage(err, 'Could not submit this URL.'))
    } finally {
      setIsSubmittingSingle(false)
    }
  }

  const handleSubmitBatch = async () => {
    if (batchUrls.length === 0) return
    setIsSubmittingBatch(true)
    setBatchError(null)
    try {
      await UrlSubmissionServices.submitUrlBatch(batchUrls)
      setBatchInput('')
      refresh()
    } catch (err) {
      setBatchError(extractErrorMessage(err, 'Could not submit this batch.'))
    } finally {
      setIsSubmittingBatch(false)
    }
  }

  const handleFetch = async () => {
    if (!fetchUrlInput.trim()) return
    setIsFetching(true)
    setFetchError(null)
    try {
      await UrlSubmissionServices.fetchUrl(fetchUrlInput.trim())
      setFetchUrlInput('')
      refresh()
    } catch (err) {
      setFetchError(extractErrorMessage(err, 'Could not fetch this URL as Bingbot.'))
    } finally {
      setIsFetching(false)
    }
  }

  const fetchedUrls = data?.fetchedUrls ?? []

  const columns: ExtendedColumnDef<BingFetchedUrl>[] = [
    {
      id: 'url',
      accessorKey: 'url',
      header: 'URL',
      cell: ({ row }) => <span className="max-w-md truncate text-sm">{row.original.url}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) =>
        row.original.expired ? (
          <ElementBadge variant="muted">Expired</ElementBadge>
        ) : row.original.fetched ? (
          <ElementBadge variant="success">Fetched</ElementBadge>
        ) : (
          <ElementBadge variant="info">Pending</ElementBadge>
        ),
    },
    {
      id: 'date',
      header: 'Date',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDateTime(row.original.date)}</span>,
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">URL Submission</h1>
        <p className="text-sm text-muted-foreground">
          Submit URLs directly to Bing and fetch a page as Bingbot to see what it sees.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : !data || data.status === 'not_connected' ? (
        <EmptyState title="Bing Webmaster Tools is not connected">
          {data?.reason ??
            'Connect Bing Webmaster Tools under Settings → Integrations to submit URLs.'}
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <QuotaTile label="URL submission quota" quota={data.urlQuota} />
            <QuotaTile label="Content submission quota" quota={data.contentQuota} />
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
            <div>
              <p className="text-sm font-semibold">Submit a URL</p>
              <p className="text-xs text-muted-foreground">A single page to ask Bing to crawl.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={singleUrl}
                onChange={(event) => setSingleUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSubmitSingle()
                }}
                placeholder="https://flowcms.tech/blog/example-post"
                className="h-9 min-w-[280px] flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
              />
              <ElementButton size="sm" onClick={() => void handleSubmitSingle()} disabled={isSubmittingSingle}>
                <Send size={14} />
                {isSubmittingSingle ? 'Submitting…' : 'Submit URL'}
              </ElementButton>
            </div>
            {singleError && <p className="text-sm text-destructive">{singleError}</p>}
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
            <div>
              <p className="text-sm font-semibold">Submit a batch</p>
              <p className="text-xs text-muted-foreground">
                One URL per line, up to 500. {batchUrls.length} URL{batchUrls.length === 1 ? '' : 's'} entered.
              </p>
            </div>
            <textarea
              value={batchInput}
              onChange={(event) => setBatchInput(event.target.value)}
              placeholder={'https://flowcms.tech/blog/post-1\nhttps://flowcms.tech/blog/post-2'}
              rows={5}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <div>
              <ElementButton
                size="sm"
                onClick={() => void handleSubmitBatch()}
                disabled={isSubmittingBatch || batchUrls.length === 0 || batchUrls.length > 500}
              >
                <Send size={14} />
                {isSubmittingBatch ? 'Submitting…' : 'Submit batch'}
              </ElementButton>
            </div>
            {batchUrls.length > 500 && (
              <p className="text-sm text-destructive">A batch is limited to 500 URLs at a time.</p>
            )}
            {batchError && <p className="text-sm text-destructive">{batchError}</p>}
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
            <div>
              <p className="text-sm font-semibold">Fetch as Bingbot</p>
              <p className="text-xs text-muted-foreground">
                See what Bing&apos;s crawler receives for a URL. The result appears in the table below once Bing
                completes the fetch.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={fetchUrlInput}
                onChange={(event) => setFetchUrlInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleFetch()
                }}
                placeholder="https://flowcms.tech/"
                className="h-9 min-w-[280px] flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
              />
              <ElementButton size="sm" onClick={() => void handleFetch()} disabled={isFetching}>
                <Bot size={14} />
                {isFetching ? 'Fetching…' : 'Fetch URL'}
              </ElementButton>
            </div>
            {fetchError && <p className="text-sm text-destructive">{fetchError}</p>}
          </div>

          {fetchedUrls.length === 0 ? (
            <EmptyState title="No fetched URLs yet">
              Submit or fetch a URL above to see its history here.
            </EmptyState>
          ) : (
            <PaginatedDimensionTable<BingFetchedUrl>
              columns={columns}
              rows={fetchedUrls}
              emptyContent={<p>No fetched URLs.</p>}
            />
          )}
        </>
      )}
    </div>
  )
}
