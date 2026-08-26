"use client"

import { createContext, useContext, useMemo } from "react"
import { DEFAULT_ADMIN_PATH, joinAdminPath } from "./adminPathCore"

/**
 * The configured public admin path, delivered to client components.
 *
 * A server component resolves it and passes it down. It is deliberately NOT
 * read from a NEXT_PUBLIC_* variable: those are inlined into the client bundle
 * at build time, so an operator who changed FLOWCMS_ADMIN_PATH and restarted
 * would get server-side routing at the new path while every client-rendered
 * link still pointed at the old one. One runtime source of truth, or none.
 */
const AdminPathContext = createContext<string>(DEFAULT_ADMIN_PATH)

export function AdminPathProvider({
  value,
  children,
}: {
  value: string
  children: React.ReactNode
}) {
  return <AdminPathContext.Provider value={value}>{children}</AdminPathContext.Provider>
}

/** The admin root, e.g. `/control-center`. */
export function useAdminPath(): string {
  return useContext(AdminPathContext)
}

/**
 * A builder for admin URLs: `const adminHref = useAdminHref()`, then
 * `adminHref('/blog/posts')`.
 *
 * Returned as a function rather than a bare string so module-scope navigation
 * tables can stay admin-relative and be joined at render — a hook cannot be
 * called at module scope, and those tables are where most of this app's links
 * actually live.
 */
export function useAdminHref(): (sub?: string) => string {
  const root = useAdminPath()
  return useMemo(() => (sub?: string) => joinAdminPath(root, sub), [root])
}
