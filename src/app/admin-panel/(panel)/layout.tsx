import { auth, signOut } from "@/Framework/Auth/auth"
import { adminLoginPath } from "@/Framework/Config/adminPath"
import { getBrand, getGscConfig, getBingConfig } from "@/Framework/Settings/SettingsService"
import { StorageService } from "@/Framework/Storage/StorageService"
import DashboardLayout from "@/Modules/Dashboard/DashboardLayout"

const LOGO_URL_TTL_SECONDS = 3600

export default async function AdminShellLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [session, brand, gsc, bing] = await Promise.all([
    auth(),
    getBrand(),
    getGscConfig(),
    getBingConfig(),
  ])
  const logoUrl = brand.logoKey
    ? await StorageService.getPresignedDownloadUrl(brand.logoKey, LOGO_URL_TTL_SECONDS)
    : null

  async function handleSignOut() {
    "use server"
    await signOut({ redirectTo: adminLoginPath() })
  }

  return (
    <DashboardLayout
      user={session?.user}
      brand={{ siteName: brand.siteName, logoUrl }}
      gscConnected={!!gsc.refreshToken}
      bingConnected={!!bing.apiKey && !!bing.siteUrl}
      onSignOut={handleSignOut}
    >
      {children}
    </DashboardLayout>
  )
}
