'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { PlugZap, CheckCircle2, XCircle } from 'lucide-react'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import { StatTile, WidgetCard, WidgetEmpty } from '@/Modules/Dashboard/Components/DashboardWidgets'
import { OverviewServices } from './Services/OverviewServices'

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
      <PlugZap size={22} className="text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs leading-snug text-muted-foreground">{children}</p>
    </div>
  )
}

export default function OverviewModule() {
  const adminHref = useAdminHref()
  const { data, isLoading } = useQuery({
    queryKey: ['bing-overview'],
    queryFn: OverviewServices.overview,
  })

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Bing Webmaster</h1>
        <p className="text-sm text-muted-foreground">
          Connection status, verified sites, and submission quotas for the connected Bing Webmaster
          account.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Loading Bing Webmaster data…
        </div>
      ) : !data || data.status === 'not_connected' ? (
        <EmptyState title="Bing Webmaster Tools is not connected">
          {data?.reason ??
            'Connect Bing Webmaster Tools under Settings → Integrations to see traffic, keywords, crawl, and index data here.'}
        </EmptyState>
      ) : (
        <>
          <WidgetCard
            title="Connection"
            description={data.siteUrl}
            action={{ label: 'Manage', href: adminHref('/settings/integrations') }}
          >
            {data.siteVerified ? (
              <ElementBadge variant="success" startContent={<CheckCircle2 size={12} />}>
                Verified on Bing Webmaster Tools
              </ElementBadge>
            ) : (
              <ElementBadge variant="warning" startContent={<XCircle size={12} />}>
                Not found among this account&apos;s verified sites
              </ElementBadge>
            )}
          </WidgetCard>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatTile
              label="URL submissions left today"
              value={data.urlSubmissionQuota?.dailyQuota ?? 0}
              href={adminHref("/bing-webmaster/url-submission")}
            />
            <StatTile
              label="Content submissions left today"
              value={data.contentSubmissionQuota?.dailyQuota ?? 0}
              href={adminHref("/bing-webmaster/url-submission")}
            />
          </div>

          <WidgetCard
            title="Sites on this account"
            description="Every site visible to the connected API key"
          >
            {data.sites.length === 0 ? (
              <WidgetEmpty>No sites found on this Bing Webmaster account.</WidgetEmpty>
            ) : (
              <ul className="flex flex-col">
                {data.sites.map((site) => (
                  <li
                    key={site.url}
                    className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-sm last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate">{site.url}</span>
                    <ElementBadge variant={site.isVerified ? 'success' : 'muted'}>
                      {site.isVerified ? 'Verified' : 'Not verified'}
                    </ElementBadge>
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>

          <p className="text-xs text-muted-foreground">
            See{' '}
            <Link href={adminHref("/bing-webmaster/traffic")} className="underline">
              Traffic &amp; Rank
            </Link>{' '}
            for search performance, or any other section in the sidebar for a specific data category.
          </p>
        </>
      )}
    </div>
  )
}
