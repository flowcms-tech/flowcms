'use client'

import Link from 'next/link'
import { ArrowRight, ShieldAlert, AlertTriangle, Sparkles } from 'lucide-react'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import type { ActionFeedItem } from '../Types'

const SEVERITY_META = {
  critical: { icon: ShieldAlert, badge: 'destructive' as const, label: 'Critical' },
  warning: { icon: AlertTriangle, badge: 'warning' as const, label: 'Warning' },
  opportunity: { icon: Sparkles, badge: 'info' as const, label: 'Opportunity' },
}

const SOURCE_LABELS: Record<ActionFeedItem['source'], string> = {
  issues_log: 'Issues Log',
  page_indexing: 'Page Indexing',
  sitemaps: 'Sitemaps',
  enhancements: 'Enhancements',
  core_web_vitals: 'Core Web Vitals',
  links: 'Links',
  report: 'Report',
}

export default function ActionFeedItemCard({ item }: { item: ActionFeedItem }) {
  const meta = SEVERITY_META[item.severity]
  const Icon = meta.icon

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Icon size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <ElementBadge variant={meta.badge}>{meta.label}</ElementBadge>
              <ElementBadge variant="muted">{SOURCE_LABELS[item.source]}</ElementBadge>
            </div>
            <p className="text-sm font-medium">{item.title}</p>
            {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
          </div>
        </div>
      </div>

      {item.urls.length > 0 && (
        <ul className="ml-[26px] flex flex-col gap-0.5">
          {item.urls.map((url) => (
            <li key={url} className="truncate text-xs text-muted-foreground">
              {url}
            </li>
          ))}
        </ul>
      )}

      <div className="ml-[26px]">
        <Link
          href={item.href}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View details
          <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  )
}
