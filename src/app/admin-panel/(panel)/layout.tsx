import { auth, signOut } from "@/Framework/Auth/auth"
import { adminLoginPath } from "@/Framework/Config/adminPath"
import { getBrand, getGscConfig, getBingConfig } from "@/Framework/Settings/SettingsService"
import { mediaPath } from "@/Framework/Storage/mediaUrl"
import DashboardLayout from "@/Modules/Dashboard/DashboardLayout"

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
    ? mediaPath(brand.logoKey)
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
