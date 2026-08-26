'use client'

import { useState } from 'react'
import { FormProvider, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { MENU_ITEM_TYPES, type MenuItemType } from '@/db/schema/menus'
import { createMenuItemSchema } from '../Values/MenuValidations'
import { MenuServices } from '../Services/MenuServices'
import type { MenuItemAdminView } from '../Values/menuAdminView'

/**
 * Add or edit one menu item.
 *
 * `react-hook-form` + `zodResolver` with the SAME schema the route uses, so the
 * browser cannot accept a `javascript:` link the server would refuse — the
 * check is one function, imported by both.
 *
 * The target field changes meaning with the type, and the form says so rather
 * than presenting one ambiguous box: a custom link takes a path or URL, and the
 * four entity types take something chosen from the content that exists. The
 * entity pickers are `serverFetch` selects against the existing admin list
 * endpoints, so no new route was added for the form.
 */

const TYPE_LABELS: Record<MenuItemType, string> = {
  custom: 'Custom link',
  page: 'Page',
  post: 'Blog post',
  category: 'Category',
  tag: 'Tag',
}

const ENTITY_SOURCE: Record<Exclude<MenuItemType, 'custom'>, { url: string; label: string }> = {
  page: { url: '/api/pages', label: 'title' },
  post: { url: '/api/blog/posts', label: 'title' },
  category: { url: '/api/blog/categories', label: 'name' },
  tag: { url: '/api/blog/tags', label: 'name' },
}

/** The form's own shape: `parentId` is a select, so "top level" is the empty
 *  string here and becomes null on the way out. */
const formSchema = createMenuItemSchema

type Values = {
  label: string
  type: MenuItemType
  target: string
  parentId?: string | null
  isActive?: boolean
  opensInNewTab?: boolean
}

export default function MenuItemForm({
  menuId,
  item,
  parents,
  onClose,
  onSaved,
}: {
  menuId: string
  item: MenuItemAdminView | null
  /** Top-level items in this menu, offered as parents. */
  parents: MenuItemAdminView[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      label: item?.label ?? '',
      type: item?.type ?? 'custom',
      target: item?.target ?? '',
      parentId: item?.parentId ?? '',
      isActive: item?.isActive ?? true,
      opensInNewTab: item?.opensInNewTab ?? false,
    },
  })

  const type = (useWatch({ control: form.control, name: 'type' }) ?? 'custom') as MenuItemType
  const source = type === 'custom' ? null : ENTITY_SOURCE[type]

  const save = useMutation({
    mutationFn: async (values: Values) => {
      const payload = {
        label: values.label.trim(),
        type: values.type,
        target: values.target.trim(),
        parentId: values.parentId === '' || values.parentId === undefined ? null : values.parentId,
        isActive: values.isActive ?? true,
        opensInNewTab: values.opensInNewTab ?? false,
      }
      return item
        ? MenuServices.updateItem(menuId, item.id, payload)
        : MenuServices.addItem(menuId, payload)
    },
    onMutate: () => setServerErrors([]),
    onSuccess: onSaved,
    onError: (error: unknown) => {
      const response = (error as { response?: { status?: number; data?: { message?: unknown } } }).response
      if (response?.status === 422) {
        const message = response.data?.message
        setServerErrors(Array.isArray(message) ? message.map(String) : [String(message)])
      } else {
        setServerErrors(['That could not be saved. Please try again.'])
      }
    },
  })

  return (
    <ElementModal isOpen title={item ? 'Edit item' : 'Add item'} onClose={onClose}>
      <FormProvider {...form}>
        <form
          className="flex flex-col gap-3"
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          <ElementInput name="label" label="Label" placeholder="About us" required />

          <ElementSelect
            name="type"
            label="Links to"
            items={MENU_ITEM_TYPES.map((value) => ({ value, label: TYPE_LABELS[value] }))}
          />

          {type === 'custom' ? (
            <ElementInput
              // Keyed by type so switching away and back gives a clean field
              // rather than an entity id sitting in a URL box.
              key="custom-target"
              name="target"
              label="Link"
              placeholder="/about or https://example.com"
              hint="A path on this site, or a full http(s) address. Other schemes are refused."
              required
            />
          ) : (
            <ElementSelect
              key={`entity-target-${type}`}
              name="target"
              label={TYPE_LABELS[type]}
              placeholder={`Choose a ${TYPE_LABELS[type].toLowerCase()}`}
              serverFetch={{
                url: source!.url,
                keyMap: { label: source!.label, value: 'id' },
              }}
            />
          )}

          <ElementSelect
            name="parentId"
            label="Nested under"
            hint="Menus are two levels deep. Leave as Top level for a main item."
            items={[
              { value: '', label: 'Top level' },
              ...parents
                // An item cannot be its own parent; the API refuses it too.
                .filter((candidate) => candidate.id !== item?.id)
                .map((candidate) => ({ value: candidate.id, label: candidate.label })),
            ]}
          />

          <ElementCheckbox name="isActive" label="Visible on the site" />
          <ElementCheckbox
            name="opensInNewTab"
            label="Open in a new tab"
            hint="The theme adds rel=noopener, so the new page cannot reach back into this one."
          />

          {serverErrors.length > 0 && <ValidationBox messages={serverErrors} />}

          <div className="flex justify-end gap-2">
            <ElementButton type="button" variant="outline" onClick={onClose}>
              Cancel
            </ElementButton>
            <ElementButton type="submit" isLoading={save.isPending}>
              {item ? 'Save item' : 'Add item'}
            </ElementButton>
          </div>
        </form>
      </FormProvider>
    </ElementModal>
  )
}
