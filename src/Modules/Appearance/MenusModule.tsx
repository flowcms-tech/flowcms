'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ExternalLink,
  Info,
  Link2Off,
  Plus,
  Trash2,
} from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { cn } from '@/lib/utils'
import { MenuServices } from './Services/MenuServices'
import type {
  MenuAdminItemGroup,
  MenuAdminView,
  MenuItemAdminView,
  SlotOrigin,
} from './Values/menuAdminView'
import MenuItemForm from './Components/MenuItemForm'
import MenuNameForm from './Components/MenuNameForm'

/**
 * Appearance → Menus.
 *
 * ORDERING IS BUTTONS, NOT DRAG-AND-DROP. `@dnd-kit` is already a dependency
 * and `ElementTable` uses it, so a drag surface was available — but a two-level
 * tree with a parent selector is a different interaction from a flat sortable
 * list, and shipping a half-working drag surface in v0.1 would be worse than a
 * pair of arrows that always do exactly what they say. The API takes a whole
 * ordering, so swapping this for drag-and-drop later changes this file only.
 *
 * VOCABULARY. A slot is "live" when the theme currently rendering declares it,
 * "dormant" when another installed theme declares it, and "unused" when no
 * installed theme does. A dormant or unused menu is stored, editable, and
 * simply not rendered — it is never cleaned up, because an operator switching
 * themes has not asked to lose their navigation.
 */

const ORIGIN_COPY: Record<SlotOrigin, { label: string; variant: 'success' | 'muted' | 'warning'; hint: string }> = {
  rendered: { label: 'Live', variant: 'success', hint: 'The theme rendering the site uses this location.' },
  installed: {
    label: 'Dormant',
    variant: 'muted',
    hint: 'Another installed theme uses this location. Stored and ready, not on the site right now.',
  },
  unknown: {
    label: 'Unused',
    variant: 'warning',
    hint: 'No installed theme has this location — probably a theme that was removed. Nothing has been deleted.',
  },
}

function ItemRow({
  item,
  depth,
  onEdit,
  onDelete,
  onMove,
  canMoveUp,
  canMoveDown,
  busy,
}: {
  item: MenuItemAdminView
  depth: 0 | 1
  onEdit: () => void
  onDelete: () => void
  onMove: (direction: -1 | 1) => void
  canMoveUp: boolean
  canMoveDown: boolean
  busy: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 border-b border-border px-3 py-2 last:border-b-0',
        depth === 1 && 'pl-10',
        !item.isActive && 'opacity-60',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <ElementButton
          variant="ghost"
          size="icon"
          aria-label="Move up"
          disabled={!canMoveUp || busy}
          onClick={() => onMove(-1)}
        >
          <ChevronUp size={14} />
        </ElementButton>
        <ElementButton
          variant="ghost"
          size="icon"
          aria-label="Move down"
          disabled={!canMoveDown || busy}
          onClick={() => onMove(1)}
        >
          <ChevronDown size={14} />
        </ElementButton>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.label}</span>
          <ElementBadge variant="muted">{item.type}</ElementBadge>
          {!item.isActive && (
            <ElementBadge variant="muted" className="gap-1">
              <EyeOff size={11} />
              Hidden
            </ElementBadge>
          )}
          {item.opensInNewTab && (
            <ElementBadge variant="muted" className="gap-1">
              <ExternalLink size={11} />
              New tab
            </ElementBadge>
          )}
          {item.isBroken && (
            <ElementBadge variant="destructive" className="gap-1">
              <Link2Off size={11} />
              Broken link
            </ElementBadge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {item.isBroken
            ? /* The stored target, so the operator can see WHAT is missing.
                 Rendered as text, never as an href — a broken reference is not
                 something to offer as a link. */
              `Points at ${item.type} "${item.target}", which is not published or no longer exists`
            : item.href}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <ElementButton variant="outline" size="sm" onClick={onEdit} disabled={busy}>
          Edit
        </ElementButton>
        <ElementButton variant="ghost" size="icon" aria-label="Delete item" onClick={onDelete} disabled={busy}>
          <Trash2 size={15} />
        </ElementButton>
      </div>
    </div>
  )
}

export default function MenusModule({ initialView }: { initialView: MenuAdminView }) {
  const queryClient = useQueryClient()
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [creating, setCreating] = useState<{ location: string } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [itemForm, setItemForm] = useState<{ menuId: string; item: MenuItemAdminView | null } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<
    { kind: 'menu'; id: string; label: string } | { kind: 'item'; menuId: string; id: string; label: string } | null
  >(null)

  const { data: view } = useQuery({
    queryKey: ['appearance-menus'],
    queryFn: MenuServices.list,
    initialData: initialView,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['appearance-menus'] })

  const capture = (key: string) => (error: unknown) => {
    const response = (error as { response?: { status?: number; data?: { message?: unknown } } }).response
    if (response?.status === 422) {
      const message = response.data?.message
      setErrors({ [key]: Array.isArray(message) ? message.map(String) : [String(message)] })
    }
  }

  const createMenu = useMutation({
    mutationFn: (values: { name: string; location: string }) => MenuServices.createMenu(values),
    onMutate: () => setErrors({}),
    onSuccess: async () => {
      setCreating(null)
      await refresh()
    },
    onError: capture('create'),
  })

  const renameMenu = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => MenuServices.updateMenu(id, { name }),
    onSuccess: async () => {
      setRenaming(null)
      await refresh()
    },
    onError: capture('rename'),
  })

  const removeMenu = useMutation({
    mutationFn: (id: string) => MenuServices.deleteMenu(id),
    onSuccess: async () => {
      setConfirmDelete(null)
      await refresh()
    },
    onError: capture('delete'),
  })

  const removeItem = useMutation({
    mutationFn: ({ menuId, id }: { menuId: string; id: string }) => MenuServices.deleteItem(menuId, id),
    onSuccess: async () => {
      setConfirmDelete(null)
      await refresh()
    },
    onError: capture('delete'),
  })

  const reorder = useMutation({
    mutationFn: ({ menuId, items }: { menuId: string; items: Array<{ id: string; parentId: string | null }> }) =>
      MenuServices.reorder(menuId, items),
    onSuccess: refresh,
    onError: capture('reorder'),
  })

  /**
   * Flatten a menu to the full ordered list the reorder API expects, with one
   * item swapped with its neighbour inside its own group.
   *
   * Swapping within the group is what makes "up" mean what it looks like: a
   * child moving up must not jump out from under its parent.
   */
  function moveWithin(groups: MenuAdminItemGroup[], target: MenuItemAdminView, direction: -1 | 1) {
    const siblings =
      target.parentId === null
        ? groups.map((group) => group.item)
        : (groups.find((group) => group.item.id === target.parentId)?.children ?? [])

    const index = siblings.findIndex((item) => item.id === target.id)
    const swapWith = index + direction
    if (index < 0 || swapWith < 0 || swapWith >= siblings.length) return null

    const reordered = [...siblings]
    ;[reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]]

    // Rebuild the whole menu in its new order — parents in order, each
    // followed by its children.
    const topLevel = target.parentId === null ? reordered : groups.map((group) => group.item)
    return topLevel.flatMap((parent) => {
      const children =
        target.parentId === parent.id
          ? reordered
          : (groups.find((group) => group.item.id === parent.id)?.children ?? [])
      return [
        { id: parent.id, parentId: null as string | null },
        ...children.map((child) => ({ id: child.id, parentId: parent.id as string | null })),
      ]
    })
  }

  const busy = reorder.isPending || removeItem.isPending || removeMenu.isPending

  return (
    <div className="flex flex-col gap-6 p-4">
      <header>
        <h1 className="text-xl font-bold">Menus</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Navigation for the locations your theme provides. Changes appear on the site immediately.
        </p>
      </header>

      {errors.reorder && <ValidationBox messages={errors.reorder} />}
      {errors.delete && <ValidationBox messages={errors.delete} />}

      {view.menus.length === 0 && view.availableSlots.length === 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-border p-4 text-sm text-muted-foreground">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
          The installed themes declare no menu locations, so there is nowhere to put a menu yet.
        </p>
      )}

      {view.menus.map((menu) => {
        const origin = ORIGIN_COPY[menu.origin]
        return (
          <section key={menu.id} className="rounded-xl border border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{menu.name}</h2>
                  <ElementBadge variant={origin.variant}>{origin.label}</ElementBadge>
                  <ElementBadge variant="muted">{menu.location}</ElementBadge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{origin.hint}</p>
              </div>
              <div className="flex items-center gap-2">
                <ElementButton
                  variant="outline"
                  size="sm"
                  onClick={() => setItemForm({ menuId: menu.id, item: null })}
                >
                  <Plus size={14} />
                  Add item
                </ElementButton>
                <ElementButton
                  variant="outline"
                  size="sm"
                  onClick={() => setRenaming({ id: menu.id, name: menu.name })}
                >
                  Rename
                </ElementButton>
                <ElementButton
                  variant="ghost"
                  size="icon"
                  aria-label="Delete menu"
                  onClick={() => setConfirmDelete({ kind: 'menu', id: menu.id, label: menu.name })}
                >
                  <Trash2 size={15} />
                </ElementButton>
              </div>
            </div>

            {menu.orphanCount > 0 && (
              <p className="flex items-start gap-2 border-b border-border bg-warning-light p-3 text-sm">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
                {menu.orphanCount} item{menu.orphanCount === 1 ? '' : 's'} cannot be placed in this
                menu and {menu.orphanCount === 1 ? 'is' : 'are'} not shown on the site. Editing an
                item and choosing a parent will fix it.
              </p>
            )}

            {menu.groups.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                This menu is empty. Nothing is rendered for this location until an item is added.
              </p>
            ) : (
              <div>
                {menu.groups.map((group, groupIndex) => (
                  <div key={group.item.id}>
                    <ItemRow
                      item={group.item}
                      depth={0}
                      busy={busy}
                      canMoveUp={groupIndex > 0}
                      canMoveDown={groupIndex < menu.groups.length - 1}
                      onEdit={() => setItemForm({ menuId: menu.id, item: group.item })}
                      onDelete={() =>
                        setConfirmDelete({
                          kind: 'item',
                          menuId: menu.id,
                          id: group.item.id,
                          label: group.item.label,
                        })
                      }
                      onMove={(direction) => {
                        const items = moveWithin(menu.groups, group.item, direction)
                        if (items) reorder.mutate({ menuId: menu.id, items })
                      }}
                    />
                    {group.children.map((child, childIndex) => (
                      <ItemRow
                        key={child.id}
                        item={child}
                        depth={1}
                        busy={busy}
                        canMoveUp={childIndex > 0}
                        canMoveDown={childIndex < group.children.length - 1}
                        onEdit={() => setItemForm({ menuId: menu.id, item: child })}
                        onDelete={() =>
                          setConfirmDelete({
                            kind: 'item',
                            menuId: menu.id,
                            id: child.id,
                            label: child.label,
                          })
                        }
                        onMove={(direction) => {
                          const items = moveWithin(menu.groups, child, direction)
                          if (items) reorder.mutate({ menuId: menu.id, items })
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}

      {view.availableSlots.length > 0 && (
        <section className="rounded-xl border border-dashed border-border p-4">
          <h2 className="font-semibold">Locations with no menu yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These come from the themes installed in this build. Adding a theme adds locations;
            it never removes a menu you already made.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {view.availableSlots.map((slot) => (
              <ElementButton
                key={slot.slot}
                variant="outline"
                size="sm"
                onClick={() => {
                  setCreating({ location: slot.slot })
                  setErrors({})
                }}
              >
                <Plus size={14} />
                {slot.slot}
                <span className="text-xs text-muted-foreground">({slot.themes.join(', ')})</span>
              </ElementButton>
            ))}
          </div>
        </section>
      )}

      <p className="flex items-start gap-2 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <Eye size={16} className="mt-0.5 shrink-0" aria-hidden />
        The site is rendering the <span className="font-medium">{view.renderingThemeSlug}</span> theme,
        so only its locations are live. Menus for other locations stay exactly as they are.
      </p>

      {creating && (
        <MenuNameForm
          title={`New menu for "${creating.location}"`}
          location={creating.location}
          submitLabel="Create menu"
          isSaving={createMenu.isPending}
          serverErrors={errors.create ?? []}
          onClose={() => setCreating(null)}
          onSubmit={(values) => createMenu.mutate({ name: values.name, location: creating.location })}
        />
      )}

      {renaming && (
        <MenuNameForm
          title="Rename menu"
          defaultName={renaming.name}
          submitLabel="Save name"
          isSaving={renameMenu.isPending}
          serverErrors={errors.rename ?? []}
          onClose={() => setRenaming(null)}
          onSubmit={(values) => renameMenu.mutate({ id: renaming.id, name: values.name })}
        />
      )}

      {itemForm && (
        <MenuItemForm
          menuId={itemForm.menuId}
          item={itemForm.item}
          parents={
            view.menus
              .find((menu) => menu.id === itemForm.menuId)
              ?.groups.map((group) => group.item) ?? []
          }
          onClose={() => setItemForm(null)}
          onSaved={async () => {
            setItemForm(null)
            await refresh()
          }}
        />
      )}

      <ElementModal.Confirm
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={confirmDelete?.kind === 'menu' ? 'Delete this menu?' : 'Remove this item?'}
        description={
          confirmDelete?.kind === 'menu'
            ? `"${confirmDelete.label}" and all of its items will be deleted. The location stays available.`
            : `"${confirmDelete?.label}" and anything nested under it will be removed from the menu.`
        }
        confirmText="Delete"
        onConfirm={() => {
          if (!confirmDelete) return
          if (confirmDelete.kind === 'menu') removeMenu.mutate(confirmDelete.id)
          else removeItem.mutate({ menuId: confirmDelete.menuId, id: confirmDelete.id })
        }}
      />
    </div>
  )
}
