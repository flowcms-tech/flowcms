import { auth } from "@/Framework/Auth/auth"
import DashboardHomeModule from "@/Modules/Dashboard/DashboardHomeModule"

export default async function AdminDashboardPage() {
  const session = await auth()

  return <DashboardHomeModule userName={session?.user?.name || session?.user?.email || "there"} />
}
