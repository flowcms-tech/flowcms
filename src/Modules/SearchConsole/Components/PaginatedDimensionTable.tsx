'use client'

import { useState } from 'react'
import type { Row } from '@tanstack/react-table'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import { ElementTablePagination } from '@/components/shared/ElementTable/ElementTablePagination'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'

const TABLE_PAGE_SIZE = 10

/**
 * Client-side paged table — deliberately NOT `ElementTable`'s own
 * `totalCount` pagination, which reads/writes the page number through the
 * URL (`?page=`). That's the right model for one table per screen; here it's
 * reused across several dimension tables sharing one page (behind tabs, or
 * stacked sections), which would otherwise all fight over the same `page`
 * query param. Reuses `ElementTablePagination` directly in its
 * `syncWithUrl={false}` mode instead, which is exactly the "no router"
 * escape hatch it already exists for.
 */
export default function PaginatedDimensionTable<TData extends Record<string, unknown>>({
  columns,
  rows,
  emptyContent,
  expandedRowContent,
}: {
  columns: ExtendedColumnDef<TData>[]
  rows: TData[]
  emptyContent: React.ReactNode
  expandedRowContent?: (row: Row<TData>) => React.ReactNode
}) {
  const [page, setPage] = useState(1)

  // A new set of rows (tab switch that keeps this component mounted, a
  // date-range change, a re-check) can be shorter than the page the user
  // was on — reset rather than strand them on a page that no longer exists.
  // Done during render (React's documented pattern for "adjusting state
  // when a prop changes"), not in an effect: an effect would commit the
  // stale page first and only fix it a render later.
  const [prevRows, setPrevRows] = useState(rows)
  if (rows !== prevRows) {
    setPrevRows(rows)
    setPage(1)
  }

  const start = (page - 1) * TABLE_PAGE_SIZE
  const pageRows = rows.slice(start, start + TABLE_PAGE_SIZE)

  return (
    <div className="flex flex-col rounded-xl border border-border bg-background">
      <ElementTable<TData>
        columns={columns}
        data={pageRows}
        emptyContent={emptyContent}
        classNames={{ container: 'rounded-none border-none shadow-none' }}
        expandedRowContent={expandedRowContent}
      />
      <div className="border-t border-border px-4">
        <ElementTablePagination
          totalCount={rows.length}
          defaultPageSize={TABLE_PAGE_SIZE}
          syncWithUrl={false}
          page={page}
          onPageChange={setPage}
        />
      </div>
    </div>
  )
}
