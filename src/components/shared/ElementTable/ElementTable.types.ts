import { type ColumnDef, type Row } from "@tanstack/react-table"
import { type ClassValue } from "clsx"
import { type ReactNode } from "react"

export type ExtendedColumnDef<TData extends Record<string, unknown>> =
  ColumnDef<TData, unknown> & {
    sort?: boolean
    sortKey?: string
    alignRight?: boolean
  }

export type ElementTableClassNames = Partial<
  Record<
    | "container"
    | "headerContent"
    | "table"
    | "thead"
    | "th"
    | "tbody"
    | "td",
    ClassValue
  >
>

export interface ElementTableProps<TData extends Record<string, unknown>> {
  columns: ExtendedColumnDef<TData>[]
  data: TData[]

  loading?: boolean
  loadingRows?: number

  emptyContent?: ReactNode
  headerContent?: ReactNode

  classNames?: ElementTableClassNames

  onSort?: (columnId: string, desc: boolean) => void
  syncSortWithUrl?: boolean

  expandedRowContent?: (row: Row<TData>) => ReactNode

  onReorder?: (items: TData[]) => void
  isDragDisabled?: boolean

  onSelectionChange?: (rows: TData[]) => void
  bulkActionContent?: (rows: TData[], clearSelection: () => void) => ReactNode

  /**
   * Makes the whole row activatable. Clicks originating in the checkbox cell
   * are excluded; anything else in a cell that must not trigger it (a menu
   * trigger, a link) should stop propagation itself.
   */
  onRowClick?: (row: TData) => void
  /** Extra classes per row — for dimming rows that are present but not choosable. */
  rowClassName?: (row: TData) => ClassValue

  totalCount?: number
  pageSize?: number
}
