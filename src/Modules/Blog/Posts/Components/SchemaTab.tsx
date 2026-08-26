'use client'

import { useEffect, useRef, useState } from 'react'
import { useFieldArray, useFormContext, type FieldValues } from 'react-hook-form'
import { GripVertical, Info, Plus, X } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementFileSelector from '@/components/shared/ElementFileSelector/ElementFileSelector'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import { SCHEMA_TYPES, type SchemaType } from '../Values/Validations'
import { NumberField } from '../Values/BlogPostValues'
import SchemaJsonPreview, { type SchemaJsonPreviewProps } from './SchemaJsonPreview'

const TYPE_ITEMS = SCHEMA_TYPES.map((type) => ({ label: type, value: type }))

const TYPE_HINTS: Record<SchemaType, string> = {
  BlogPosting: 'The default, and right for almost every post. No extra fields.',
  Article: 'A general article. Interchangeable with BlogPosting for search purposes.',
  NewsArticle: 'Only for time-sensitive reporting. Also the type the news sitemap filters on.',
  HowTo: 'A step-by-step procedure. The steps must also appear on the page — see below.',
  Review: 'A review of one specific product or service, with a rating you stand behind.',
  VideoObject: 'A post built around a video. Needs a real video URL and upload date.',
}

/** Empty payload per type, so switching to HowTo lands on a form with two step
 *  rows rather than a blank the editor has to discover the Add button for. */
function defaultPayload(type: SchemaType): unknown {
  if (type === 'HowTo') {
    return {
      totalTime: '',
      estimatedCost: '',
      tools: [],
      supplies: [],
      steps: [
        { name: '', text: '', imageKey: '' },
        { name: '', text: '', imageKey: '' },
      ],
    }
  }
  if (type === 'Review') {
    return { itemName: '', itemType: 'Product', rating: 0, bestRating: 5, worstRating: 1, pros: [], cons: [] }
  }
  if (type === 'VideoObject') {
    return { contentUrl: '', embedUrl: '', thumbnailKey: '', uploadDate: '', duration: '' }
  }
  return undefined
}

/** Repeatable free-text list (tools, supplies, pros, cons, speakable selectors).
 *  watch/setValue rather than `useFieldArray`, which keys rows off an injected
 *  object id a bare string array has nowhere to hold. */
function StringListField({
  name,
  label,
  placeholder,
  hint,
  disabled,
}: {
  name: string
  label: string
  placeholder: string
  hint?: string
  disabled?: boolean
}) {
  const { watch, setValue } = useFormContext<FieldValues>()
  const items: string[] = watch(name) ?? []
  const [draft, setDraft] = useState('')

  function commit(next: string[]) {
    setValue(name, next, { shouldValidate: true, shouldDirty: true })
  }

  function add() {
    const value = draft.trim()
    if (!value) return
    commit([...items, value])
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium leading-none">{label}</span>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item, index) => (
            <span
              key={`${item}-${index}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs"
            >
              {item}
              <button
                type="button"
                disabled={disabled}
                onClick={() => commit(items.filter((_, i) => i !== index))}
                className="text-muted-foreground transition-colors hover:text-destructive"
                title="Remove"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
          placeholder={placeholder}
          className="h-9 w-full max-w-md rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
        />
        <ElementButton size="sm" variant="outline" onClick={add} disabled={disabled || !draft.trim()}>
          <Plus size={13} />
          Add
        </ElementButton>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function HowToFields({ disabled }: { disabled?: boolean }) {
  const { control } = useFormContext<FieldValues>()
  const { fields, append, remove } = useFieldArray({ control, name: 'schemaData.steps' })

  return (
    <div className="flex flex-col gap-4">
      {/* The rule Google actually enforces, stated where the mistake gets made.
          Markup describing content a visitor cannot see is a manual-action
          risk, not a shortcut. */}
      <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-light/40 p-3 text-xs leading-snug">
        <Info size={14} className="mt-0.5 shrink-0 text-warning" />
        <span>
          <span className="font-medium">These steps also render on the public page</span>, as a
          numbered list, and they must match what the post actually says. Google treats
          structured data describing content a visitor cannot see as spam, and there is no
          markup-only mode here on purpose.
        </span>
      </p>

      <div className="grid grid-cols-2 gap-4">
        <ElementInput
          name="schemaData.totalTime"
          label="Total Time"
          placeholder="e.g. PT30M"
          hint="ISO 8601 duration — PT30M is thirty minutes, PT1H30M is an hour and a half."
          disabled={disabled}
        />
        <ElementInput
          name="schemaData.estimatedCost"
          label="Estimated Cost"
          placeholder="e.g. CAD 40"
          hint="Currency code plus amount. Leave empty rather than guessing."
          disabled={disabled}
        />
      </div>

      <StringListField
        name="schemaData.tools"
        label="Tools"
        placeholder="e.g. Phillips screwdriver"
        hint="Things the reader uses but does not consume."
        disabled={disabled}
      />
      <StringListField
        name="schemaData.supplies"
        label="Supplies"
        placeholder="e.g. Replacement deadbolt"
        hint="Things the reader consumes or installs."
        disabled={disabled}
      />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Steps</span>
          <ElementButton
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => append({ name: '', text: '', imageKey: '' })}
          >
            <Plus size={13} />
            Add step
          </ElementButton>
        </div>

        {fields.length < 2 && (
          <p className="text-xs text-warning">
            Google rejects a single-step HowTo. Two is the minimum that is meaningfully a
            procedure.
          </p>
        )}

        {fields.map((field, index) => (
          <div key={field.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <GripVertical size={13} />
                Step {index + 1}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(index)}
                className="text-muted-foreground transition-colors hover:text-destructive"
                title="Remove step"
              >
                <X size={14} />
              </button>
            </div>
            <ElementInput
              name={`schemaData.steps.${index}.name`}
              label="Step name"
              placeholder="e.g. Remove the old cylinder"
              required
              disabled={disabled}
            />
            <ElementTextArea
              name={`schemaData.steps.${index}.text`}
              label="Instructions"
              placeholder="What the reader does, in one or two sentences."
              rows={3}
              required
              disabled={disabled}
            />
            <ElementFileSelector
              name={`schemaData.steps.${index}.imageKey`}
              label="Step image"
              hint="Optional. A photo of this step specifically, not a stock shot of the finished job."
              accept="image"
              disabled={disabled}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function ReviewFields({ disabled }: { disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <ElementInput
          name="schemaData.itemName"
          label="Item Reviewed"
          placeholder="e.g. Schlage B60N Deadbolt"
          required
          disabled={disabled}
        />
        <ElementInput
          name="schemaData.itemType"
          label="Item Type"
          placeholder="Product"
          hint="A schema.org type — Product, Service, LocalBusiness. Product covers most cases."
          disabled={disabled}
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <NumberField name="schemaData.rating" label="Rating" placeholder="4.5" required disabled={disabled} />
        <NumberField name="schemaData.bestRating" label="Best Possible" placeholder="5" disabled={disabled} />
        <NumberField name="schemaData.worstRating" label="Worst Possible" placeholder="1" disabled={disabled} />
      </div>
      <StringListField name="schemaData.pros" label="Pros" placeholder="e.g. Solid ANSI Grade 1 build" disabled={disabled} />
      <StringListField name="schemaData.cons" label="Cons" placeholder="e.g. Stiff for the first week" disabled={disabled} />
      <p className="text-xs text-muted-foreground">
        The pros, cons and rating must reflect a review a reader can actually read on this
        page. A rating with no review behind it is the kind of markup that earns a manual
        action.
      </p>
    </div>
  )
}

function VideoFields({ disabled }: { disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <ElementInput
          name="schemaData.contentUrl"
          label="Video File URL"
          placeholder="https://…/video.mp4"
          hint="The video file itself. Must be absolute."
          required
          disabled={disabled}
        />
        <ElementInput
          name="schemaData.embedUrl"
          label="Embed URL"
          placeholder="https://www.youtube.com/embed/…"
          hint="The player URL, if the video is embedded rather than hosted."
          disabled={disabled}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <ElementInput
          name="schemaData.uploadDate"
          label="Upload Date"
          type="date"
          required
          disabled={disabled}
        />
        <ElementInput
          name="schemaData.duration"
          label="Duration"
          placeholder="PT4M30S"
          hint="ISO 8601 — PT4M30S is four minutes thirty. The only format schema.org accepts."
          disabled={disabled}
        />
      </div>
      <ElementFileSelector
        name="schemaData.thumbnailKey"
        label="Thumbnail"
        hint="Required by Google for a video rich result. Falls back to the featured image if left empty."
        accept="image"
        disabled={disabled}
      />
    </div>
  )
}

export interface SchemaTabProps {
  disabled?: boolean
  /** Everything the JSON-LD preview needs that does not live on this tab. */
  preview: Omit<SchemaJsonPreviewProps, 'schemaType' | 'schemaData'>
}

export default function SchemaTab({ disabled, preview }: SchemaTabProps) {
  const { watch, getValues, setValue } = useFormContext<FieldValues>()
  const schemaType = (watch('schemaType') ?? 'BlogPosting') as SchemaType
  const schemaData = watch('schemaData')
  const previousType = useRef<SchemaType>(schemaType)

  /**
   * Park the outgoing type's payload before swapping in the incoming one.
   *
   * `schemaDrafts` is a UI-only form field the modules strip before sending —
   * it lives in form state rather than component state because the tab
   * unmounts whenever the editor switches to General, and losing ten typed-in
   * HowTo steps to a tab click is not a trade anyone would accept.
   */
  useEffect(() => {
    if (previousType.current === schemaType) return

    const drafts = { ...((getValues('schemaDrafts') as Record<string, unknown>) ?? {}) }
    drafts[previousType.current] = getValues('schemaData')
    setValue('schemaDrafts', drafts, { shouldDirty: false })
    setValue('schemaData', drafts[schemaType] ?? defaultPayload(schemaType), {
      shouldDirty: true,
      shouldValidate: false,
    })
    previousType.current = schemaType
  }, [schemaType, getValues, setValue])

  return (
    <div className="flex flex-col gap-5">
      <ElementSelect
        name="schemaType"
        label="Schema Type"
        placeholder="BlogPosting"
        hint={TYPE_HINTS[schemaType]}
        items={TYPE_ITEMS}
        disabled={disabled}
        classNames={{ root: 'max-w-sm' }}
      />

      <p className="text-xs text-muted-foreground">{TYPE_HINTS[schemaType]}</p>

      {schemaType === 'HowTo' && <HowToFields disabled={disabled} />}
      {schemaType === 'Review' && <ReviewFields disabled={disabled} />}
      {schemaType === 'VideoObject' && <VideoFields disabled={disabled} />}

      <StringListField
        name="speakableSelectors"
        label="Speakable Selectors"
        placeholder="e.g. .post-body > p:first-of-type"
        hint="CSS selectors marking the one or two sentences worth reading aloud by a voice assistant. Rarely worth customising — the field exists so the selector is not hardcoded into a template that will change."
        disabled={disabled}
      />

      <div className="border-t border-border pt-4">
        <SchemaJsonPreview {...preview} schemaType={schemaType} schemaData={schemaData} />
      </div>
    </div>
  )
}
