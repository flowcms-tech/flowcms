"use client"

import * as React from "react"
import { useMemo, useState, useEffect, useCallback } from "react"
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type Row,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronRight } from "lucide-react"
import type { ClassValue } from "clsx"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
// Hooks from this import are only ever CALLED inside ElementTableWithNav,
// which is never rendered when syncSortWithUrl={false}, so this component is
// safe to render outside an App Router context (e.g. in tests).
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import type {
  ExtendedColumnDef,
  ElementTableClassNames,
  ElementTableProps,
} from "./ElementTable.types"
import { DraggableTableBody, SortableWrapper } from "./ElementTableDnd"
import { ElementTablePagination } from "./ElementTablePagination"

// --- Nav adapter -------------------------------------------------------------

interface NavAdapter {
  router: { push: (url: string) => void; replace: (url: string) => void }
  pathname: string
  searchParams: URLSearchParams
}

const NULL_NAV: NavAdapter = {
  router: { push: () => {}, replace: () => {} },
  pathname: "/",
  searchParams: new URLSearchParams(),
}

// --- SortIcon -----------------------------------------------------------------

function SortIcon({ sorting, columnId }: { sorting: SortingState; columnId: string }) {
  const current = useMemo(
    () => sorting.find((s) => s.id === columnId),
    [sorting, columnId]
  )
  return (
    <span className="ml-1.5 inline-flex">
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        className={cn(
          "transition-transform fill-current",
          current ? (current.desc ? "rotate-180 opacity-80" : "opacity-80") : "opacity-30"
        )}
      >
        <path d="M6 2L10 8H2L6 2Z" />
      </svg>
    </span>
  )
}

// --- TableHead ----------------------------------------------------------------

function TableHead<TData extends Record<string, unknown>>({
  table,
  classNames,
  hasExpandable,
  isDraggable,
  hasCheckbox,
  sorting,
  onSortColumn,
}: {
  table: ReturnType<typeof useReactTable<TData>>
  classNames?: ElementTableClassNames
  hasExpandable: boolean
  isDraggable: boolean
  hasCheckbox: boolean
  sorting: SortingState
  onSortColumn: (col: Column<TData, unknown>) => void
}) {
  return (
    <thead className={cn("border-b border-border text-xs text-muted-foreground", classNames?.thead)}>
      {table.getHeaderGroups().map((hg) => (
        <tr key={hg.id}>
          {isDraggable && <th className="w-10 pl-4" />}
          {hasExpandable && <th className="w-10 pl-4" />}
          {hasCheckbox && (
            <th className="w-10 pl-4">
              <Checkbox
                checked={
                  table.getIsAllPageRowsSelected()
                    ? true
                    : table.getIsSomePageRowsSelected()
                    ? "indeterminate"
                    : false
                }
                onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
                aria-label="Select all"
              />
            </th>
          )}
          {hg.headers.map((header) => {
            const def = header.column.columnDef as ExtendedColumnDef<TData>
            const sortable = !!def.sort
            return (
              <th
                key={header.id}
                colSpan={header.colSpan}
                onClick={() => sortable && onSortColumn(header.column)}
                className={cn(
                  "px-4 py-3 font-medium tracking-wide whitespace-nowrap text-start",
                  sortable && "cursor-pointer select-none hover:text-foreground transition-colors",
                  def.alignRight && "text-end",
                  classNames?.th
                )}
              >
                <span className="inline-flex items-center">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                  {sortable && <SortIcon sorting={sorting} columnId={header.column.id} />}
                </span>
              </th>
            )
          })}
        </tr>
      ))}
    </thead>
  )
}

// --- TableLoading -------------------------------------------------------------

function TableLoading({
  colCount,
  rows = 5,
  classNames,
}: {
  colCount: number
  rows?: number
  classNames?: ElementTableClassNames
}) {
  return (
    <tbody className={cn("divide-y divide-border", classNames?.tbody)}>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          <td colSpan={colCount} className={cn("px-4 py-2", classNames?.td)}>
            <Skeleton className="h-9 w-full" />
          </td>
        </tr>
      ))}
    </tbody>
  )
}

// --- TableEmpty ---------------------------------------------------------------

function TableEmpty({ content }: { content?: React.ReactNode }) {
  return (
    <div className="flex min-h-60 items-center justify-center text-sm text-muted-foreground">
      {content ?? <p>No data to display.</p>}
    </div>
  )
}

// --- ExtendedRowWrapper -------------------------------------------------------

function ExtendedRowWrapper({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="w-full overflow-hidden"
      initial={{ height: 0, opacity: 0 }}
      animate={{
        height: "auto",
        opacity: 1,
        transition: {
          height: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
          opacity: { duration: 0.2, delay: 0.05 },
        },
      }}
      exit={{
        height: 0,
        opacity: 0,
        transition: {
          height: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
          opacity: { duration: 0.1 },
        },
      }}
    >
      {children}
    </motion.div>
  )
}

// --- TableBody (static) -------------------------------------------------------

function TableBody<TData extends Record<string, unknown>>({
  table,
  classNames,
  hasExpandable,
  hasCheckbox,
  expandedRowContent,
  onRowClick,
  rowClassName,
}: {
  table: ReturnType<typeof useReactTable<TData>>
  classNames?: ElementTableClassNames
  hasExpandable: boolean
  hasCheckbox: boolean
  expandedRowContent?: (row: Row<TData>) => React.ReactNode
  onRowClick?: (row: TData) => void
  rowClassName?: (row: TData) => ClassValue
}) {
  const [openRowId, setOpenRowId] = useState<string | null>(null)

  // Collapse any expanded row when the underlying data set changes (new page,
  // new filter, etc.) — adjusted during render per React's guidance, since an
  // effect here would cause an extra commit just to reset local UI state.
  const [prevData, setPrevData] = useState(table.options.data)
  if (table.options.data !== prevData) {
    setPrevData(table.options.data)
    setOpenRowId(null)
  }

  return (
    <tbody className={cn("divide-y divide-border", classNames?.tbody)}>
      {table.getRowModel().rows.map((row) => (
        <React.Fragment key={row.id}>
          <tr
            onClick={onRowClick ? () => onRowClick(row.original) : undefined}
            className={cn(
              "transition-colors hover:bg-muted/50",
              row.getIsSelected() && "bg-muted/30",
              onRowClick && "cursor-pointer",
              rowClassName?.(row.original)
            )}
          >
            {hasExpandable && (
              <td
                className="w-10 pl-4 cursor-pointer text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  setOpenRowId((p) => (p === row.id ? null : row.id))
                }}
              >
                <ChevronRight
                  size={16}
                  className={cn("transition-transform", openRowId === row.id && "rotate-90")}
                />
              </td>
            )}
            {hasCheckbox && (
              // Ticking a row is not activating it: without this, a row-click
              // handler would fire alongside every checkbox toggle.
              <td className="w-10 pl-4" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(v) => row.toggleSelected(!!v)}
                  aria-label="Select row"
                />
              </td>
            )}
            {row.getVisibleCells().map((cell) => {
              const def = cell.column.columnDef as ExtendedColumnDef<TData>
              return (
                <td
                  key={cell.id}
                  className={cn(
                    "px-4 py-3 text-sm text-foreground whitespace-nowrap",
                    def.alignRight && "text-right",
                    classNames?.td
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              )
            })}
          </tr>

          {hasExpandable && expandedRowContent && (
            <AnimatePresence>
              {openRowId === row.id && (
                <tr key={`${row.id}-exp`}>
                  <td
                    colSpan={
                      table.getVisibleLeafColumns().length +
                      (hasExpandable ? 1 : 0) +
                      (hasCheckbox ? 1 : 0)
                    }
                    className="p-0"
                  >
                    <ExtendedRowWrapper>
                      <div className="px-4 py-3 bg-muted/20 border-b border-border">
                        {expandedRowContent(row)}
                      </div>
                    </ExtendedRowWrapper>
                  </td>
                </tr>
              )}
            </AnimatePresence>
          )}
        </React.Fragment>
      ))}
    </tbody>
  )
}

// --- ElementTableCore ---------------------------------------------------------
// Pure component — receives navigation as a prop, no next/navigation hooks.

function ElementTableCore<TData extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  loadingRows = 5,
  emptyContent,
  headerContent,
  classNames,
  onSort,
  syncSortWithUrl,
  expandedRowContent,
  onReorder,
  isDragDisabled = false,
  onSelectionChange,
  bulkActionContent,
  onRowClick,
  rowClassName,
  totalCount,
  pageSize = 10,
  nav,
}: ElementTableProps<TData> & { nav: NavAdapter }) {
  const isDraggable = Boolean(onReorder)
  const hasCheckbox = Boolean(onSelectionChange || bulkActionContent)
  const hasExpandable = Boolean(expandedRowContent)

  const [sorting, setSorting] = useState<SortingState>(() => {
    if (!syncSortWithUrl) return []
    const sortParam = nav.searchParams.get("sort")
    if (!sortParam) return []
    const [key, dir] = sortParam.split("_")
    const col = columns.find(
      (c) =>
        (c as { accessorKey?: string }).accessorKey === key ||
        c.id === key ||
        c.sortKey === key
    )
    if (!col) return []
    const id = col.id ?? (col as { accessorKey?: string }).accessorKey ?? key
    return [{ id, desc: dir === "desc" }]
  })

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [dndRows, setDndRows] = useState<TData[]>(data)
  const [localPage, setLocalPage] = useState(1)

  useEffect(() => { setDndRows(data) }, [data])

  const handleSortColumn = useCallback(
    (column: Column<TData, unknown>) => {
      const def = column.columnDef as ExtendedColumnDef<TData>
      const colId = column.id
      setSorting((prev) => {
        const current = prev.find((s) => s.id === colId)
        let next: SortingState
        if (!current) next = [{ id: colId, desc: false }]
        else if (!current.desc) next = [{ id: colId, desc: true }]
        else next = []

        if (syncSortWithUrl) {
          const params = new URLSearchParams(nav.searchParams.toString())
          const sortKey = def.sortKey ?? colId
          if (next.length) {
            params.set("sort", `${sortKey}_${next[0].desc ? "desc" : "asc"}`)
            params.set("pageNumber", "1")
          } else {
            params.delete("sort")
          }
          nav.router.replace(`${nav.pathname}?${params.toString()}`)
        }

        if (onSort && next.length) {
          onSort(def.sortKey ?? colId, next[0].desc)
        }

        return next
      })
    },
    [syncSortWithUrl, nav, onSort]
  )

  const table = useReactTable({
    data: isDraggable ? dndRows : data,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getCoreRowModel: getCoreRowModel(),
    manualSorting: Boolean(onSort),
    enableRowSelection: hasCheckbox,
    // Row ids default to array index, which breaks drag-and-drop: after a
    // reorder the item that moved gets a *different* id (its new index), so
    // dnd-kit's SortableContext can't track it and the drop position lags a
    // reorder behind. Use the data's own stable id when it has one.
    getRowId: (row, index) => (typeof row.id === "string" ? row.id : String(index)),
  })

  const selectedRows = useMemo(
    () => table.getSelectedRowModel().rows.map((r) => r.original),
    [table]
  )

  useEffect(() => {
    onSelectionChange?.(selectedRows)
  }, [selectedRows]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleReorder = useCallback(
    (newItems: Record<string, unknown>[]) => {
      setDndRows(newItems as TData[])
      onReorder?.(newItems as TData[])
    },
    [onReorder]
  )

  const dndItems = useMemo(
    () =>
      table
        .getRowModel()
        .rows.map((r) => ({ id: r.id, original: r.original as Record<string, unknown> })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table.getRowModel().rows]
  )

  const totalColSpan =
    table.getVisibleLeafColumns().length +
    (hasExpandable ? 1 : 0) +
    (hasCheckbox ? 1 : 0) +
    (isDraggable ? 1 : 0)

  const tableContent = (
    <div
      className={cn(
        "bg-background border border-border rounded-xl overflow-hidden shadow-sm",
        classNames?.container
      )}
    >
      {headerContent && (
        <div className={cn("px-5 py-4 border-b border-border", classNames?.headerContent)}>
          {headerContent}
        </div>
      )}

      {hasCheckbox && selectedRows.length > 0 && bulkActionContent && (
        <div className="px-5 py-2.5 bg-primary/5 border-b border-border flex items-center gap-3">
          <span className="text-sm font-medium text-primary">
            {selectedRows.length} selected
          </span>
          {bulkActionContent(selectedRows, () => setRowSelection({}))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto styled-scrollbar">
        <table className={cn("min-w-full divide-y divide-border", classNames?.table)}>
          <TableHead
            table={table}
            classNames={classNames}
            hasExpandable={hasExpandable}
            isDraggable={isDraggable}
            hasCheckbox={hasCheckbox}
            sorting={sorting}
            onSortColumn={handleSortColumn}
          />

          {loading ? (
            <TableLoading colCount={totalColSpan} rows={loadingRows} classNames={classNames} />
          ) : isDraggable ? (
            <DraggableTableBody
              table={table}
              classNames={classNames}
              hasCheckbox={hasCheckbox}
              isDragDisabled={isDragDisabled}
            />
          ) : (
            <TableBody
              table={table}
              classNames={classNames}
              hasExpandable={hasExpandable}
              hasCheckbox={hasCheckbox}
              expandedRowContent={expandedRowContent}
              onRowClick={onRowClick}
              rowClassName={rowClassName}
            />
          )}
        </table>

        {!loading && data.length === 0 && <TableEmpty content={emptyContent} />}
      </div>

      {totalCount !== undefined && (
        <div className="border-t border-border px-4">
          <ElementTablePagination
            totalCount={totalCount}
            defaultPageSize={pageSize}
            syncWithUrl={nav !== NULL_NAV}
            page={localPage}
            onPageChange={setLocalPage}
          />
        </div>
      )}
    </div>
  )

  return isDraggable ? (
    <SortableWrapper items={dndItems} onReorder={handleReorder}>
      {tableContent}
    </SortableWrapper>
  ) : tableContent
}

// --- ElementTableWithNav ------------------------------------------------------
// Holds next/navigation hooks. Only rendered inside Next.js App Router context
// (i.e. when syncSortWithUrl=true).

function ElementTableWithNav<TData extends Record<string, unknown>>(
  props: ElementTableProps<TData>
) {
  const router = useRouter()
  const pathname = usePathname()
  const rawSearchParams = useSearchParams()
  const searchParams = useMemo(
    () => new URLSearchParams(rawSearchParams.toString()),
    [rawSearchParams]
  )
  return (
    <ElementTableCore {...props} nav={{ router, pathname, searchParams }} />
  )
}

// --- Public export ------------------------------------------------------------

export default function ElementTable<TData extends Record<string, unknown>>(
  props: ElementTableProps<TData>
) {
  // When syncSortWithUrl is false (most tests, and any non-App-Router host),
  // render the pure Core — next/navigation hooks are never called.
  if (!props.syncSortWithUrl) {
    return <ElementTableCore {...props} nav={NULL_NAV} />
  }
  // Only rendered in Next.js App Router context.
  return <ElementTableWithNav {...props} />
}
