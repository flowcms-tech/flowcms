"use client"

import { useState, useSyncExternalStore } from "react"
import { LogOut, Palette, User } from "lucide-react"
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import ThemeSelectorModal from "@/components/shared/ThemeSelectorModal/ThemeSelectorModal"
import { getThemeCookie } from "@/Framework/utils/cookieUtils"
import DashboardSidebar from "./DashboardSidebar"
import DashboardBreadcrumb from "./DashboardBreadcrumb"

interface DashboardLayoutProps {
  children: React.ReactNode
  user?: { name?: string | null; email?: string | null }
  brand: { siteName: string; logoUrl: string | null }
  gscConnected: boolean
  bingConnected: boolean
  onSignOut: () => void
}

function subscribeNoop() {
  return () => {}
}

function getHasNoThemeCookie() {
  return !getThemeCookie()
}

function getHasNoThemeCookieServer() {
  return false
}

export default function DashboardLayout({
  children,
  user,
  brand,
  gscConnected,
  bingConnected,
  onSignOut,
}: DashboardLayoutProps) {
  // Reading a browser cookie needs to stay hydration-safe (server never has
  // one), so this is derived via useSyncExternalStore instead of an
  // effect+setState — the snapshot naturally starts false on the server and
  // resolves to the real value right after hydration.
  const hasNoThemeCookie = useSyncExternalStore(
    subscribeNoop,
    getHasNoThemeCookie,
    getHasNoThemeCookieServer
  )
  const [dismissed, setDismissed] = useState(false)
  const [manuallyOpened, setManuallyOpened] = useState(false)

  const themeModalOpen = manuallyOpened || (hasNoThemeCookie && !dismissed)

  const handleThemeModalChange = (open: boolean) => {
    setManuallyOpened(open)
    if (!open) setDismissed(true)
  }

  return (
    <SidebarProvider>
      <DashboardSidebar brand={brand} gscConnected={gscConnected} bingConnected={bingConnected} />
      {/* min-h-0 is load-bearing: SidebarInset is a flex child of the h-svh
          provider wrapper, and a flex item's default min-height is its
          content size, not 0 — without this it grows past the viewport
          instead of capping there, so the page scrolls AND <main>'s own
          overflow-y-auto scrolls, two scrollbars for one page. */}
      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <DashboardBreadcrumb />

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setManuallyOpened(true)}
              aria-label="Change theme"
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Palette size={16} />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                <div className="flex size-7 items-center justify-center rounded-full bg-muted">
                  <User size={14} />
                </div>
                <span className="hidden sm:inline">{user?.name || user?.email}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="font-medium">{user?.name || "Admin"}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {user?.email}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onSignOut()}
                >
                  <LogOut size={14} />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</main>
      </SidebarInset>

      <ThemeSelectorModal open={themeModalOpen} onOpenChange={handleThemeModalChange} />
    </SidebarProvider>
  )
}
