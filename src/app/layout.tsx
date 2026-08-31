import type { Metadata } from "next"
import { cookies } from "next/headers"
import { Montserrat } from "next/font/google"
import { GeistMono } from "geist/font/mono"
import "./globals.css"
import QueryProvider from "@/Framework/API_Layer/QueryProvider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { isThemeScheme } from "@/Framework/utils/cookieUtils"
import Providers from "@/app/Providers";
import ElementToast from "@/components/shared/ElementToast/ElementToast"
import { getBaseUrl, getBrand } from "@/Framework/Settings/SettingsService"
import { getAdminPath } from "@/Framework/Config/adminPath"
import { AdminPathProvider } from "@/Framework/Config/AdminPathProvider"
import { publicImageUrl } from "@/Framework/Storage/publicImageUrl"

/**
 * The application typeface, admin panel included. Exposed as
 * --font-montserrat, which globals.css maps onto --font-sans and
 * --font-heading.
 *
 * Loaded through `next/font/google`, which downloads and self-hosts it at
 * build time — no request reaches Google at runtime. It does mean the build
 * needs network access; self-hosting the file outright is queued with the
 * Docker work, where offline and air-gapped builds actually matter.
 *
 * A theme is free to declare its own typeface; this is only the default.
 */
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
})

export async function generateMetadata(): Promise<Metadata> {
  const [baseUrl, brand] = await Promise.all([getBaseUrl(), getBrand()])
  // The favicon appears on every ANONYMOUS page, so it cannot come from the
  // authenticated media route — and it must not be presigned either, which is
  // what it used to be: a one-hour signature on an asset that a browser caches
  // and a crawler refetches for months.
  const faviconUrl = brand.faviconKey ? publicImageUrl(brand.faviconKey) : null

  return {
    // Without this, Next resolves relative metadata URLs against a localhost
    // default and warns at build time. Every canonical, OG image, and JSON-LD
    // URL has to be absolute or crawlers reject it.
    metadataBase: new URL(baseUrl),
    title: brand.siteName,
    // Omitted rather than empty when no tagline is configured.
    ...(brand.tagline ? { description: brand.tagline } : {}),
    // Falls back to the static /favicon.ico (Next's file-convention default)
    // until a favicon is uploaded in Admin > Settings > Global.
    icons: faviconUrl ? { icon: faviconUrl } : undefined,
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const cookieStore = await cookies()
  const themeValue = cookieStore.get("theme_scheme")?.value ?? null
  const theme = isThemeScheme(themeValue) ? themeValue : "dark"
  const themeClasses = [
    theme.startsWith("dark") && "dark",
    theme.endsWith("blue") && "theme-blue",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <html
      lang="en"
      dir="ltr"
      className={`h-full antialiased ${montserrat.variable} ${GeistMono.variable} ${themeClasses}`}
    >
      <body className="min-h-full flex flex-col">
      {/*
        * The configured admin path is resolved here, in a server component, and
        * handed to client components through context. It sits at the root
        * rather than in the admin layout because the login page lives outside
        * the (panel) route group and needs it too.
        */}
      <AdminPathProvider value={getAdminPath()}>
      <Providers>
      <QueryProvider>
          <TooltipProvider delayDuration={0}>
            <ElementToast>{children}</ElementToast>
          </TooltipProvider>
        </QueryProvider>
      </Providers>
      </AdminPathProvider>
      </body>
    </html>
  )
}
