"use client"

import * as React from "react"
import { useCallback, useMemo } from "react"
import { flexRender, type Row, type Table } from "@tanstack/react-table"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Loader } from "lucide-react"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import type { ExtendedColumnDef, ElementTableClassNames } from "./ElementTable.types"

// Stable references — recreating these every render forces DndContext to
// re-evaluate sensors/modifiers on each SortableWrapper re-render, which adds
// up to noticeable jank on drag when the parent tree re-renders frequently.
const DND_MODIFIERS = [restrictToVerticalAxis, restrictToParentElement]
const ACTIVATION_CONSTRAINT = { distance: 5 }

// --- SortableWrapper ----------------------------------------------------------

export function SortableWrapper({
  items,
  onReorder,
  children,
}: {
  items: { id: string; original: Record<string, unknown> }[]
  onReorder: (newItems: Record<string, unknown>[]) => void
  children: React.ReactNode
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: ACTIVATION_CONSTRAINT })
  )

  const ids = useMemo(() => items.map((r) => r.id), [items])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = items.findIndex((r) => r.id === String(active.id))
      const newIndex = items.findIndex((r) => r.id === String(over.id))
      if (oldIndex === -1 || newIndex === -1) return
      const reordered = arrayMove(items, oldIndex, newIndex)
      onReorder(reordered.map((r) => r.original))
    },
    [items, onReorder]
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={DND_MODIFIERS}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

// --- DraggableRow -------------------------------------------------------------
// Memoized: during a drag, dnd-kit's context updates on every pointer move,
// but only rows whose transform actually changed need to re-render — without
// this, an unrelated re-render higher up the tree re-renders every row.

function DraggableRowImpl<TData extends Record<string, unknown>>({
  row,
  classNames,
  hasCheckbox,
  isDragDisabled,
}: {
  row: Row<TData>
  classNames?: ElementTableClassNames
  hasCheckbox: boolean
  isDragDisabled?: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id, disabled: isDragDisabled })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { zIndex: 1, position: "relative" as const, opacity: 0.85 } : {}),
  }

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={cn(
        "transition-colors hover:bg-muted/50",
        row.getIsSelected() && "bg-muted/30"
      )}
    >
      {/* drag handle */}
      <td
        ref={setActivatorNodeRef}
        {...attributes}
        {...(!isDragDisabled ? listeners : {})}
        className="w-10 pl-4 text-muted-foreground touch-none"
      >
        {isDragDisabled ? (
          <Loader size={16} className="animate-spin" />
        ) : (
          <GripVertical size={16} className="cursor-grab active:cursor-grabbing" />
        )}
      </td>

      {hasCheckbox && (
        <td className="w-10 pl-4">
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
  )
}

const DraggableRow = React.memo(DraggableRowImpl) as typeof DraggableRowImpl

// --- DraggableTableBody -------------------------------------------------------

export function DraggableTableBody<TData extends Record<string, unknown>>({
  table,
  classNames,
  hasCheckbox,
  isDragDisabled,
}: {
  table: Table<TData>
  classNames?: ElementTableClassNames
  hasCheckbox: boolean
  isDragDisabled?: boolean
}) {
  return (
    <tbody className={cn("divide-y divide-border", classNames?.tbody)}>
      {table.getRowModel().rows.map((row) => (
        <DraggableRow
          key={row.id}
          row={row}
          classNames={classNames}
          hasCheckbox={hasCheckbox}
          isDragDisabled={isDragDisabled}
        />
      ))}
    </tbody>
  )
}
