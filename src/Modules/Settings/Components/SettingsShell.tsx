'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useRouter, usePathname } from 'next/navigation'
import ElementTabs from '@/components/shared/ElementTabs/ElementTabs'
import ElementButton from '@/components/shared/ElementButton/ElementButton'

// Admin-relative hrefs: the configured root is unknown at module scope, so
// it is joined at render by adminHref().
const TABS = [
  { value: 'global', label: 'Global', href: '/settings/global' },
  { value: 'storage', label: 'Storage', href: '/settings/storage' },
  { value: 'integrations', label: 'Integrations', href: '/settings/integrations' },
  { value: 'seo', label: 'SEO', href: '/settings/seo' },
  { value: 'business', label: 'Business', href: '/settings/business' },
  { value: 'reviews', label: 'Reviews', href: '/settings/reviews' },
] as const

interface SettingsShellProps {
  description: string
  /** Omitted by tabs that aren't a single form — a Save button that saves
   *  nothing is worse than no button. */
  onSave?: () => void
  isSaving?: boolean
  children: React.ReactNode
}

export default function SettingsShell({
  description,
  onSave,
  isSaving = false,
  children,
}: SettingsShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const adminHref = useAdminHref()
  // Compare against the joined href: pathname is the public URL, tab.href is
  // admin-relative.
  const activeTab = TABS.find((tab) => pathname.startsWith(adminHref(tab.href)))?.value ?? "global"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <ElementTabs
          items={TABS.map(({ value, label }) => ({ value, label }))}
          value={activeTab}
          onValueChange={(value) => {
            const tab = TABS.find((t) => t.value === value)
            if (tab) router.push(adminHref(tab.href))
          }}
        >
          {null}
        </ElementTabs>
        {onSave && (
          <ElementButton onClick={onSave} isLoading={isSaving}>
            Save Changes
          </ElementButton>
        )}
      </div>

      <p className="text-sm text-muted-foreground">{description}</p>

      <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
        {children}
      </div>
    </div>
  )
}
