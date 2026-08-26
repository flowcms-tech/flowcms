'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useEffect, useRef } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ElementFilterBar from '@/components/shared/ElementFilterBar/ElementFilterBar'
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_ENTITY_TYPES,
  ACTIVITY_ENTITY_LABELS,
} from '@/Framework/Activity/activityTypes'
import { ActivityLogServices } from './Services/ActivityLogServices'
import { buildColumns } from './Values/ActivityLogValues'
import type { ActivityEntry } from './Types'

/** Matches ACTIVITY_PER_PAGE on the route. Both have to agree or the pagination
 *  control counts pages that don't exist. */
const PAGE_SIZE = 25

interface FilterForm {
  search: string
  action: string
  entityType: string
  actorId: string
}

const ACTION_ITEMS = ACTIVITY_ACTIONS.map((action) => ({
  value: action,
  label: ACTIVITY_ACTION_LABELS[action],
}))

const ENTITY_ITEMS = ACTIVITY_ENTITY_TYPES.map((entityType) => ({
  value: entityType,
  label: ACTIVITY_ENTITY_LABELS[entityType],
}))

/**
 * Who changed what, and when.
 *
 * Filter state lives in the URL rather than in component state, so a filtered
 * view is a link — "look at what happened to the blog last Tuesday" is a thing
 * people send each other, and it is also what makes the browser's back button
 * behave after paging through a long log.
 */
export default function ActivityLogModule() {
  const adminHref = useAdminHref()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const urlSearch = searchParams.get('search') ?? ''
  const urlAction = searchParams.get('action') ?? ''
  const urlEntityType = searchParams.get('entityType') ?? ''
  const urlActorId = searchParams.get('actorId') ?? ''
  // Carried through but not exposed as a control: it is how a future
  // "history for this post" link would arrive, and dropping it on every filter
  // change would silently widen the view someone deliberately narrowed.
  const urlEntityId = searchParams.get('entityId') ?? ''
  const urlPage = Math.max(1, Number(searchParams.get('page') ?? '1'))

  const methods = useForm<FilterForm>({
    defaultValues: {
      search: urlSearch,
      action: urlAction,
      entityType: urlEntityType,
      actorId: urlActorId,
    },
  })

  const [search, action, entityType, actorId] = methods.watch([
    'search',
    'action',
    'entityType',
    'actorId',
  ])

  // Skips the first run, so arriving on `?page=3` doesn't immediately rewrite
  // itself back to page 1 — the effect exists to react to *changes*, and on
  // mount the form is by definition already in sync with the URL.
  const isFirstSync = useRef(true)

  // One debounced writer for every filter. The dropdowns do not need the 400ms
  // wait, but two separate sync effects racing to rewrite the same URL is how
  // a dropdown change ends up reverting a search someone just typed.
  useEffect(() => {
    if (isFirstSync.current) {
      isFirstSync.current = false
      return
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      const apply = (key: string, value: string) => {
        if (value) params.set(key, value)
        else params.delete(key)
      }
      apply('search', search)
      apply('action', action)
      apply('entityType', entityType)
      apply('actorId', actorId)
      // Any filter change goes back to page 1 — page 4 of a different result
      // set is a blank screen that reads as "no activity".
      params.delete('page')
      const next = params.toString()
      router.replace(next ? `${pathname}?${next}` : pathname)
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, action, entityType, actorId])

  const { data, isLoading } = useQuery({
    queryKey: ['activity-log', urlSearch, urlAction, urlEntityType, urlActorId, urlEntityId, urlPage],
    queryFn: () =>
      ActivityLogServices.list({
        search: urlSearch || undefined,
        action: urlAction || undefined,
        entityType: urlEntityType || undefined,
        actorId: urlActorId || undefined,
        entityId: urlEntityId || undefined,
        page: urlPage,
      }),
  })

  const entries = data?.data ?? []
  const total = data?.total ?? 0
  const activeFilters = [urlSearch, urlAction, urlEntityType, urlActorId, urlEntityId].filter(Boolean)

  const header = (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold">Activity log</p>
        <p className="text-xs text-muted-foreground">
          Every change made in the panel, newest first. Entries are kept for 90 days and cannot be
          edited or removed.
        </p>
      </div>
      <ElementFilterBar triggerLabel="Filters" activeCount={activeFilters.length}>
        <FormProvider {...methods}>
          <form
            onSubmit={(e) => e.preventDefault()}
            className="flex flex-col gap-3 md:flex-row md:items-end"
          >
            <ElementInput
              name="search"
              placeholder="Search titles, details, or people"
              startIcon={<Search size={15} />}
              clearable
              classNames={{ root: 'w-full md:w-72' }}
            />
            <ElementSelect
              name="entityType"
              items={ENTITY_ITEMS}
              placeholder="Anything"
              label="Type"
              clearable
              classNames={{ root: 'w-full md:w-44' }}
            />
            <ElementSelect
              name="action"
              items={ACTION_ITEMS}
              placeholder="Any action"
              label="Action"
              clearable
              classNames={{ root: 'w-full md:w-48' }}
            />
            <ElementSelect
              name="actorId"
              /* Built from the log itself, so an account that has since been
                 deleted is not offered — its entries have no actorId to filter
                 by and the option would always return nothing. */
              items={(data?.actors ?? []).map((actor) => ({ value: actor.id, label: actor.name }))}
              placeholder="Anyone"
              label="Person"
              clearable
              searchable
              classNames={{ root: 'w-full md:w-48' }}
            />
          </form>
        </FormProvider>
      </ElementFilterBar>
    </div>
  )

  return (
    <ElementTable<ActivityEntry>
      columns={buildColumns(adminHref)}
      data={entries}
      loading={isLoading}
      loadingRows={8}
      headerContent={header}
      emptyContent={
        <p>
          {activeFilters.length > 0
            ? 'Nothing matches these filters.'
            : 'Nothing recorded yet. Changes made in the panel will show up here.'}
        </p>
      }
      totalCount={total}
      pageSize={PAGE_SIZE}
      syncSortWithUrl
    />
  )
}
