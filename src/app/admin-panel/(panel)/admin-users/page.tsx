import { auth } from "@/Framework/Auth/auth"
import { resolveRole } from "@/Framework/Auth/permissions"
import AdminUsersModule from "@/Modules/AdminUsers/AdminUsersModule"

/**
 * The signed-in user's own role is resolved here rather than fetched in the
 * module: this is a server component that already has the session, and the
 * alternative — a client-side round trip to /api/auth/session — would make the
 * role controls flicker between "everything" and "what you can actually do" on
 * every page load.
 */
export default async function AdminUsersPage() {
  const session = await auth()

  return (
    <AdminUsersModule
      currentUserId={session?.user?.id ?? ""}
      currentRole={resolveRole(session?.user?.role)}
    />
  )
}
