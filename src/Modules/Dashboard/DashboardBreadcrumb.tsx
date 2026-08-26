"use client"

import { Fragment } from "react"
import { usePathname } from "next/navigation"
import { useAdminPath } from "@/Framework/Config/AdminPathProvider"
import { ChevronRight } from "lucide-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

function toLabel(segment: string) {
  return segment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export default function DashboardBreadcrumb() {
  const pathname = usePathname()
  const adminRoot = useAdminPath()

  // Strip the configured admin root by prefix rather than filtering out a
  // single known segment: the root is operator configuration and may be nested
  // ("/internal/admin"), so there is no one segment name to drop. Slicing the
  // prefix also means a page whose own path repeats a root segment keeps it.
  const segments = (pathname.startsWith(adminRoot) ? pathname.slice(adminRoot.length) : pathname)
    .split("/")
    .filter(Boolean)

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map((segment, index) => (
          <Fragment key={segment}>
            {index > 0 && (
              <BreadcrumbSeparator>
                <ChevronRight />
              </BreadcrumbSeparator>
            )}
            <BreadcrumbItem>
              <BreadcrumbPage>{toLabel(segment)}</BreadcrumbPage>
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
