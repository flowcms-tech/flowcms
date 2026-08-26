'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlugZap, PartyPopper, ShieldAlert, AlertTriangle, Sparkles } from 'lucide-react'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ActionFeedItemCard from './Components/ActionFeedItemCard'
import { SearchConsoleServices } from './Services/SearchConsoleServices'
import { getSearchConsoleRoleCookie, setSearchConsoleRoleCookie, type SearchConsoleRole } from '@/Framework/utils/cookieUtils'
import type { ActionFeedItem } from './Types'

const ROLE_ITEMS: { label: string; value: SearchConsoleRole }[] = [
  { label: 'All', value: 'all' },
  { label: 'Developer', value: 'developer' },
  { label: 'SEO Manager', value: 'seo_manager' },
  { label: 'Marketer', value: 'marketer' },
  { label: 'Content Creator', value: 'content_creator' },
  { label: 'Executive', value: 'executive' },
]

const DEVELOPER_SOURCES: ActionFeedItem['source'][] = ['page_indexing', 'sitemaps', 'core_web_vitals']
const MARKETER_SOURCES: ActionFeedItem['source'][] = ['report', 'links']

function filterByRole(items: ActionFeedItem[], role: SearchConsoleRole, authoredPostIds: string[]): ActionFeedItem[] {
  switch (role) {
    case 'developer':
      return items.filter((item) => DEVELOPER_SOURCES.includes(item.source))
    case 'seo_manager':
      return items.filter((item) => item.source !== 'report')
    case 'marketer':
      return items.filter((item) => MARKETER_SOURCES.includes(item.source))
    case 'content_creator':
      return items.filter((item) => item.postIds.length > 0 && item.postIds.some((id) => authoredPostIds.includes(id)))
    case 'all':
    case 'executive':
    default:
      return items
  }
}

function healthBand(score: number): { label: string; className: string } {
  if (score >= 80) return { label: 'Healthy', className: 'text-success' }
  if (score >= 50) return { label: 'Needs attention', className: 'text-warning' }
  return { label: 'At risk', className: 'text-destructive' }
}

const SEVERITY_ORDER: ActionFeedItem['severity'][] = ['critical', 'warning', 'opportunity']
const SEVERITY_GROUP_META = {
  critical: { label: 'Critical', icon: ShieldAlert },
  warning: { label: 'Warnings', icon: AlertTriangle },
  opportunity: { label: 'Opportunities', icon: Sparkles },
}

export default function ActionFeedModule() {
  const [role, setRole] = useState<SearchConsoleRole>(() => getSearchConsoleRoleCookie() ?? 'all')

  function handleRoleChange(value: string | string[]) {
    const next = (Array.isArray(value) ? value[0] : value) as SearchConsoleRole
    setRole(next)
    setSearchConsoleRoleCookie(next)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['gsc-action-feed'],
    queryFn: () => SearchConsoleServices.actionFeed(),
  })

  const items = data?.items ?? []
  const authoredPostIds = data?.viewerAuthoredPostIds ?? []
  const filtered = filterByRole(items, role, authoredPostIds)

  const isExecutive = role === 'executive'
  const topCritical = filtered.filter((item) => item.severity === 'critical').slice(0, 3)
  const visibleItems = isExecutive ? topCritical : filtered

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="text-sm text-muted-foreground">
            One prioritized list, pulled from every Search Console screen — pick a role to see what matters to it.
          </p>
        </div>
        <div className="w-48">
          <ElementSelect name="search-console-role" items={ROLE_ITEMS} value={role} onValueChange={handleRoleChange} />
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : !data || data.status === 'not_connected' ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
          <PlugZap size={22} className="text-muted-foreground" />
          <p className="text-sm font-medium">Search Console is not connected</p>
          <p className="max-w-md text-xs leading-snug text-muted-foreground">
            {data?.reason ?? 'Connect Google Search Console under Settings → Integrations to see the action feed.'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Health score</p>
              <p className={`text-3xl font-semibold ${healthBand(data.healthScore).className}`}>{data.healthScore}</p>
            </div>
            <p className={`text-sm font-medium ${healthBand(data.healthScore).className}`}>
              {healthBand(data.healthScore).label}
            </p>
          </div>

          {visibleItems.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
              <PartyPopper size={22} className="text-muted-foreground" />
              <p className="text-sm font-medium">Nothing to act on</p>
              <p className="max-w-md text-xs leading-snug text-muted-foreground">
                {isExecutive
                  ? 'No critical items right now.'
                  : 'No items match this role right now — switch to "All" to see the full feed.'}
              </p>
            </div>
          ) : isExecutive ? (
            <div className="flex flex-col gap-3">
              {visibleItems.map((item) => (
                <ActionFeedItemCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            SEVERITY_ORDER.filter((severity) => visibleItems.some((item) => item.severity === severity)).map((severity) => {
              const group = visibleItems.filter((item) => item.severity === severity)
              const { label, icon: Icon } = SEVERITY_GROUP_META[severity]
              return (
                <div key={severity} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Icon size={15} />
                    {label} ({group.length})
                  </div>
                  <div className="flex flex-col gap-3">
                    {group.map((item) => (
                      <ActionFeedItemCard key={item.id} item={item} />
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </>
      )}
    </div>
  )
}
