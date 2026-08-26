'use client'

import { useState } from 'react'
import type { Row } from '@tanstack/react-table'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import { ElementTablePagination } from '@/components/shared/ElementTable/ElementTablePagination'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'

const TABLE_PAGE_SIZE = 10

/**
 * Client-side paged table — same shape and reasoning as
 * `src/Modules/SearchConsole/Components/PaginatedDimensionTable.tsx`: several
 * dimension tables share one page (behind tabs), so each needs its own page
 * cursor rather than fighting over `ElementTable`'s URL-synced `?page=`.
 * Duplicated here rather than imported cross-module — SearchConsole and
 * BingWebmaster are independent integrations with their own Types.
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
