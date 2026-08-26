'use client'

import { useQuery } from '@tanstack/react-query'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SiteSettingsServices } from './Services/SiteSettingsServices'
import BlockedUrlsTab from './Components/SiteSettingsTabs/BlockedUrlsTab'
import QueryParamsTab from './Components/SiteSettingsTabs/QueryParamsTab'
import RegionalTab from './Components/SiteSettingsTabs/RegionalTab'
import DeepLinkBlocksTab from './Components/SiteSettingsTabs/DeepLinkBlocksTab'
import PagePreviewBlocksTab from './Components/SiteSettingsTabs/PagePreviewBlocksTab'
import RolesTab from './Components/SiteSettingsTabs/RolesTab'
import SiteMovesTab from './Components/SiteSettingsTabs/SiteMovesTab'

export default function SiteSettingsModule() {
  // Any one of the 7 resources tells us whether the integration is
  // connected — they all read the same getBingConfig() gate, so the
  // cheapest one (blocked URLs) doubles as the connection probe for the
  // whole screen rather than firing a dedicated check on mount.
  const { data, isLoading } = useQuery({ queryKey: ['bing-blocked-urls'], queryFn: SiteSettingsServices.blockedUrls })

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Site Settings</h1>
        <p className="text-sm text-muted-foreground">
          Blocked URLs, URL normalization, geo-targeting, deep link and page preview blocks,
          delegated access, and site moves.
        </p>
      </div>

      {!isLoading && data?.status === 'not_connected' ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          {data.reason ?? 'Bing Webmaster Tools is not connected.'}
        </div>
      ) : (
        <Tabs defaultValue="blocked-urls">
          <TabsList>
            <TabsTrigger value="blocked-urls">Blocked URLs</TabsTrigger>
            <TabsTrigger value="query-params">Query Params</TabsTrigger>
            <TabsTrigger value="regional">Regional</TabsTrigger>
            <TabsTrigger value="deep-link-blocks">Deep Link Blocks</TabsTrigger>
            <TabsTrigger value="page-preview-blocks">Page Preview Blocks</TabsTrigger>
            <TabsTrigger value="roles">Roles</TabsTrigger>
            <TabsTrigger value="site-moves">Site Moves</TabsTrigger>
          </TabsList>
          <TabsContent value="blocked-urls" className="pt-4">
            <BlockedUrlsTab />
          </TabsContent>
          <TabsContent value="query-params" className="pt-4">
            <QueryParamsTab />
          </TabsContent>
          <TabsContent value="regional" className="pt-4">
            <RegionalTab />
          </TabsContent>
          <TabsContent value="deep-link-blocks" className="pt-4">
            <DeepLinkBlocksTab />
          </TabsContent>
          <TabsContent value="page-preview-blocks" className="pt-4">
            <PagePreviewBlocksTab />
          </TabsContent>
          <TabsContent value="roles" className="pt-4">
            <RolesTab />
          </TabsContent>
          <TabsContent value="site-moves" className="pt-4">
            <SiteMovesTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
