"use client"

import * as React from "react"
import { useMemo } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface PaginationCoreProps {
  totalCount: number
  page: number
  pageSize: number
  onNavigate: (page: number) => void
  showResultsLabel?: boolean
  className?: string
}

// --- Pure UI (no next/navigation) --------------------------------------------

function PaginationCore({
  totalCount,
  page,
  pageSize,
  onNavigate,
  showResultsLabel = true,
  className,
}: PaginationCoreProps) {
  const pageCount = Math.ceil(totalCount / pageSize)

  // Hooks must run unconditionally on every render — computed before the
  // `pageCount <= 1` early return below, even though unused in that case.
  const pages = useMemo(() => {
    const set = new Set<number>([1, pageCount, page, page - 1, page + 1])
    return Array.from(set)
      .filter((p) => p >= 1 && p <= pageCount)
      .sort((a, b) => a - b)
  }, [page, pageCount])

  if (pageCount <= 1) return null

  const canPrev = page > 1
  const canNext = page < pageCount
  const startItem = totalCount > 0 ? (page - 1) * pageSize + 1 : 0
  const endItem = Math.min(page * pageSize, totalCount)

  return (
    <div className={cn("flex items-center justify-between py-3 px-1 text-sm", className)}>
      <nav className="flex items-center gap-1" aria-label="Pagination">
        <PaginateBtn onClick={() => onNavigate(1)} disabled={!canPrev} aria-label="First page">
          <ChevronsLeft size={14} />
        </PaginateBtn>
        <PaginateBtn onClick={() => onNavigate(page - 1)} disabled={!canPrev} aria-label="Previous page">
          <ChevronLeft size={14} />
        </PaginateBtn>

        {pages.map((p, i) => {
          const prevP = pages[i - 1]
          const showEllipsis = prevP !== undefined && p - prevP > 1
          return (
            <React.Fragment key={p}>
              {showEllipsis && (
                <span className="px-1 text-muted-foreground select-none">…</span>
              )}
              <PaginateBtn
                onClick={() => onNavigate(p)}
                active={p === page}
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </PaginateBtn>
            </React.Fragment>
          )
        })}

        <PaginateBtn onClick={() => onNavigate(page + 1)} disabled={!canNext} aria-label="Next page">
          <ChevronRight size={14} />
        </PaginateBtn>
        <PaginateBtn onClick={() => onNavigate(pageCount)} disabled={!canNext} aria-label="Last page">
          <ChevronsRight size={14} />
        </PaginateBtn>
      </nav>

      {showResultsLabel && (
        <p className="text-muted-foreground">
          Showing{" "}
          <span className="font-medium text-foreground">
            {startItem.toLocaleString('en-US')}–{endItem.toLocaleString('en-US')}
          </span>{" "}
          of{" "}
          <span className="font-medium text-foreground">{totalCount.toLocaleString('en-US')}</span>
        </p>
      )}
    </div>
  )
}

// --- URL-synced wrapper (uses next/navigation) --------------------------------
// Only rendered inside Next.js App Router context.

function PaginationWithUrl({
  totalCount,
  defaultPageSize,
  showResultsLabel,
  className,
}: ElementTablePaginationProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const pageSize = useMemo(() => {
    const v = searchParams.get("pageSize")
    return v ? Math.max(1, Number(v)) : defaultPageSize
  }, [searchParams, defaultPageSize])

  const page = useMemo(() => {
    const v = searchParams.get("page")
    return v ? Math.max(1, Number(v)) : 1
  }, [searchParams])

  function navigate(newPage: number) {
    const params = new URLSearchParams(searchParams.toString())
    if (newPage <= 1) {
      params.delete("page")
    } else {
      params.set("page", String(newPage))
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <PaginationCore
      totalCount={totalCount}
      page={page}
      pageSize={pageSize ?? 10}
      onNavigate={navigate}
      showResultsLabel={showResultsLabel}
      className={className}
    />
  )
}

// --- Public API ---------------------------------------------------------------

export interface ElementTablePaginationProps {
  totalCount: number
  defaultPageSize?: number
  showResultsLabel?: boolean
  className?: string
  /** When false, renders without next/navigation hooks (safe outside App Router, e.g. tests) */
  syncWithUrl?: boolean
  /** Current page — required when syncWithUrl=false */
  page?: number
  /** Called when page changes — required when syncWithUrl=false */
  onPageChange?: (page: number) => void
}

export function ElementTablePagination({
  syncWithUrl = true,
  defaultPageSize = 10,
  page = 1,
  onPageChange,
  ...rest
}: ElementTablePaginationProps) {
  if (syncWithUrl) {
    return <PaginationWithUrl defaultPageSize={defaultPageSize} {...rest} />
  }

  return (
    <PaginationCore
      totalCount={rest.totalCount}
      page={page}
      pageSize={defaultPageSize}
      onNavigate={onPageChange ?? (() => {})}
      showResultsLabel={rest.showResultsLabel}
      className={rest.className}
    />
  )
}

// --- PaginateBtn --------------------------------------------------------------

function PaginateBtn({
  children,
  onClick,
  disabled,
  active,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-sm font-medium transition-colors",
        "border border-transparent",
        active
          ? "bg-primary text-primary-foreground"
          : "text-foreground hover:bg-muted",
        "disabled:pointer-events-none disabled:opacity-40"
      )}
      {...props}
    >
      {children}
    </button>
  )
}
