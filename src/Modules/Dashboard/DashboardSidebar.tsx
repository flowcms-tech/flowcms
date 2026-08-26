"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAdminHref, useAdminPath } from "@/Framework/Config/AdminPathProvider"
import { AnimatePresence, motion } from "framer-motion"
import { LayoutDashboard, Users, Folder, FolderTree, Tag, Newspaper, PenLine, ArrowRightLeft, Database, Settings, Layers, FileStack, Gauge, ClipboardCheck, MessageCircleQuestion, BookOpen, History, ChevronRight, Search, FileSearch, Sparkles, Zap, Link2, ShieldAlert, LayoutGrid, TrendingUp, Bot, UploadCloud, Settings2, Compass, FileText, Palette, Paintbrush, ListTree, SlidersHorizontal } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

interface NavChild {
  title: string
  url: string
  icon: React.ComponentType
  /** Exact-match only, no subtree prefix — needed for "Overview", whose
   *  path is a literal prefix of every other Search Console child route. */
  exact?: boolean
}

interface NavItem {
  title: string
  icon: React.ComponentType
  /** Leaf items link somewhere; group items render `children` instead. */
  url?: string
  children?: NavChild[]
}

const SEARCH_CONSOLE_ITEMS: NavChild[] = [
  { title: "Overview", url: "/search-console", icon: LayoutGrid, exact: true },
  { title: "Report", url: "/search-console/report", icon: Search },
  { title: "Page Indexing", url: "/search-console/page-indexing", icon: FileSearch },
  { title: "Sitemaps", url: "/search-console/sitemaps", icon: FileStack },
  { title: "Enhancements", url: "/search-console/enhancements", icon: Sparkles },
  { title: "Core Web Vitals", url: "/search-console/core-web-vitals", icon: Zap },
  { title: "Links", url: "/search-console/links", icon: Link2 },
  { title: "Issues Log", url: "/search-console/issues-log", icon: ShieldAlert },
]

const BING_WEBMASTER_ITEMS: NavChild[] = [
  { title: "Overview", url: "/bing-webmaster", icon: LayoutGrid, exact: true },
  { title: "Traffic & Rank", url: "/bing-webmaster/traffic", icon: TrendingUp },
  { title: "Keywords", url: "/bing-webmaster/keywords", icon: Search },
  { title: "URL Inspection", url: "/bing-webmaster/url-inspection", icon: FileSearch },
  { title: "Backlinks", url: "/bing-webmaster/backlinks", icon: Link2 },
  { title: "Crawl", url: "/bing-webmaster/crawl", icon: Bot },
  { title: "Sitemaps", url: "/bing-webmaster/sitemaps", icon: FileStack },
  { title: "URL Submission", url: "/bing-webmaster/url-submission", icon: UploadCloud },
  { title: "Site Settings", url: "/bing-webmaster/site-settings", icon: Settings2 },
]

/**
 * Appearance. Themes, Menus and Theme Settings.
 *
 * A group rather than a top-level "Themes" link, because those siblings are
 * coming and moving a nav item later costs an operator their muscle memory.
 * No placeholder entries for them — a link that goes nowhere is not a preview
 * of a feature, it is a dead end.
 */
const APPEARANCE_ITEMS: NavChild[] = [
  { title: "Themes", url: "/appearance/themes", icon: Paintbrush },
  { title: "Menus", url: "/appearance/menus", icon: ListTree },
  { title: "Theme Settings", url: "/appearance/theme-settings", icon: SlidersHorizontal },
]

const BLOG_ITEMS: NavChild[] = [
  { title: "Posts", url: "/blog/posts", icon: Newspaper },
  { title: "Categories", url: "/blog/categories", icon: FolderTree },
  { title: "Tags", url: "/blog/tags", icon: Tag },
  { title: "Series", url: "/blog/series", icon: Layers },
  { title: "Pending Review", url: "/blog/pending-review", icon: ClipboardCheck },
  { title: "Reader Questions", url: "/blog/questions", icon: MessageCircleQuestion },
  { title: "SEO Audit", url: "/blog/seo-audit", icon: Gauge },
  { title: "Redirects", url: "/redirects", icon: ArrowRightLeft },
]

/** `gscConnected` is threaded down from the server layout (see
 *  AdminShellLayout), which resolves it once via getGscConfig() — a nav item
 *  pointing at an integration nobody has connected yet is a dead end, not a
 *  feature, so it only appears once there is data behind it. */
function buildNavItems(gscConnected: boolean, bingConnected: boolean): NavItem[] {
  return [
    { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    ...(gscConnected
      ? [{ title: "Search Console", icon: Search, children: SEARCH_CONSOLE_ITEMS }]
      : []),
    ...(bingConnected
      ? [{ title: "Bing Webmaster", icon: Compass, children: BING_WEBMASTER_ITEMS }]
      : []),
    { title: "Admin Users", url: "/admin-users", icon: Users },
    { title: "Authors", url: "/authors", icon: PenLine },
    { title: "Blog", icon: BookOpen, children: BLOG_ITEMS },
    // Not nested under Blog: these pages are deliberately not part of the
    // blog (privacy policy, terms, etc.) — a custom URL, not a /blog/ slug.
    { title: "Pages", url: "/pages", icon: FileText },
    // Paths are stored admin-relative and joined at render by `useAdminHref`,
    // so this works unchanged under a configured FLOWCMS_ADMIN_PATH.
    { title: "Appearance", icon: Palette, children: APPEARANCE_ITEMS },
    // Top level, not under Blog: it records staff-account, settings, and
    // file-manager changes too, and burying a site-wide audit trail inside one
    // section would make it read as blog-only.
    { title: "Activity Log", url: "/activity-log", icon: History },
    { title: "Redis Cache", url: "/redis", icon: Database },
    { title: "File Manager", url: "/file-manager", icon: Folder },
    { title: "Settings", url: "/settings/global", icon: Settings },
  ]
}

/** A sub-path counts as active too, so `/blog/posts/[id]/edit` keeps "Posts"
 *  lit — unless `exact`, needed for a child whose own url is a literal
 *  prefix of a sibling's (e.g. Search Console's "Overview" vs "Report"). */
function isPathActive(pathname: string, url: string, exact?: boolean) {
  return pathname === url || (!exact && pathname.startsWith(`${url}/`))
}

function CollapsibleNavItem({
  title,
  icon: Icon,
  items,
  pathname,
}: {
  title: string
  icon: React.ComponentType
  items: NavChild[]
  pathname: string
}) {
  const adminHref = useAdminHref()
  const hasActiveChild = items.some((child) => isPathActive(pathname, child.url, child.exact))
  const [open, setOpen] = useState(hasActiveChild)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        // The group itself has no page of its own — collapsed to icons the sub
        // menu is hidden, so highlight the parent when a child is active.
        isActive={!open && hasActiveChild}
        tooltip={title}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Icon />
        <span className="truncate">{title}</span>
        <ChevronRight
          className={cn(
            "ml-auto transition-transform duration-200 group-data-[collapsible=icon]:hidden",
            open && "rotate-90"
          )}
        />
      </SidebarMenuButton>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden group-data-[collapsible=icon]:hidden"
          >
            <SidebarMenuSub>
              {items.map((child) => (
                <SidebarMenuSubItem key={child.url}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={isPathActive(pathname, child.url, child.exact)}
                  >
                    <Link href={adminHref(child.url)}>
                      <child.icon />
                      <span>{child.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </motion.div>
        )}
      </AnimatePresence>
    </SidebarMenuItem>
  )
}

interface DashboardSidebarProps {
  brand: { siteName: string; logoUrl: string | null }
  gscConnected: boolean
  bingConnected: boolean
}

export default function DashboardSidebar({ brand, gscConnected, bingConnected }: DashboardSidebarProps) {
  const adminHref = useAdminHref()
  const adminRoot = useAdminPath()
  const browserPathname = usePathname()
  const navItems = buildNavItems(gscConnected, bingConnected)

  // Nav `url`s are stored admin-relative (the configured root is unknown at
  // module scope, where the tables live), while usePathname() returns the
  // public URL. Strip the root once so every active-state comparison below
  // stays a relative-to-relative match and works under any configured path.
  const pathname = browserPathname.startsWith(adminRoot)
    ? browserPathname.slice(adminRoot.length) || "/"
    : browserPathname

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a presigned S3 URL, not a local/static asset
            <img
              src={brand.logoUrl}
              alt=""
              className="size-8 shrink-0 rounded-lg object-contain"
            />
          ) : (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              {brand.siteName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
            {brand.siteName}
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) =>
                item.children ? (
                  <CollapsibleNavItem
                    key={item.title}
                    title={item.title}
                    icon={item.icon}
                    items={item.children}
                    pathname={pathname}
                  />
                ) : (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.url}
                      tooltip={item.title}
                    >
                      <Link href={adminHref(item.url!)}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
