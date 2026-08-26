'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, FormProvider, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus } from 'lucide-react'
import type { Editor as TinyMCEEditorInstance } from 'tinymce'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementFileSelector from '@/components/shared/ElementFileSelector/ElementFileSelector'
import ElementDatePicker from '@/components/shared/ElementDatePicker/ElementDatePicker'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import ElementEditor from '@/components/shared/ElementEditor/ElementEditor'
import ElementTabs from '@/components/shared/ElementTabs/ElementTabs'
import ElementToast from '@/components/shared/ElementToast/ElementToast'
import PostFaqTab from './Components/PostFaqTab'
import DraftRecoveryBanner from './Components/DraftRecoveryBanner'
import SeoPanel, { SecondaryKeywordsField } from './Components/SeoPanel'
import SerpPreview from './Components/SerpPreview'
import SchemaTab from './Components/SchemaTab'
import InternalLinkSuggestions from './Components/InternalLinkSuggestions'
import { useDraftAutosave } from './Functions/useDraftAutosave'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { BlogCategoryServices } from '@/Modules/Blog/Categories/Services/BlogCategoryServices'
import { BlogTagServices } from '@/Modules/Blog/Tags/Services/BlogTagServices'
import { BlogSeriesServices } from '@/Modules/Blog/Series/Services/BlogSeriesServices'
import { AuthorServices } from '@/Modules/Authors/Services/AuthorServices'
import BlogCategoryCreateDrawer from '@/Modules/Blog/Categories/Components/BlogCategoryCreateDrawer'
import { buildParentOptions } from '@/Modules/Blog/Categories/Values/BlogCategoryValues'
import BlogTagCreateDrawer from '@/Modules/Blog/Tags/Components/BlogTagCreateDrawer'
import type { BlogCategory } from '@/Modules/Blog/Categories/Types'
import type { BlogTag } from '@/Modules/Blog/Tags/Types'
import { createBlogPostSchema, type CreateBlogPostFormValues } from './Values/Validations'
import { slugify, suggestExcerpt, NumberField, PrimaryCategoryPicker } from './Values/BlogPostValues'
import type { SeoAnalysisInput } from './Values/seoAnalysis'
import { BlogPostServices } from './Services/BlogPostServices'
import { BlogPostFaqServices } from './Services/BlogPostFaqServices'
import type { BlogPostFaqDraft } from './Types'

function AddFieldButton({ onClick, label }: { onClick: () => void; label: string }) {
  const adminHref = useAdminHref()
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
    >
      <Plus size={14} />
    </button>
  )
}

// Admin-relative; joined with the configured root by adminHref() at use.
const POSTS_LIST_PATH = '/blog/posts'

// Publish Date + Publish Time are UI-only fields — not part of the Zod
// schema (which only knows the combined `scheduledPublishAt` sent to the
// server). They're combined into it in onSubmit.
//
// `schemaDrafts` is UI-only too: it parks the payload of every schema type the
// editor has touched so flipping the selector to HowTo and back does not
// destroy typed-in steps. Stripped in onSubmit like the other two — the API
// only ever sees `schemaData` for the selected type.
type FormValues = CreateBlogPostFormValues & {
  scheduledPublishDate?: string
  scheduledPublishTime?: string
  schemaDrafts?: Record<string, unknown>
}

type TabValue = 'general' | 'seo' | 'content' | 'images' | 'schema' | 'faq'

// Order matters: onInvalid jumps to the FIRST tab carrying an error, so this
// has to read the way an author works through the post, not alphabetically.
const TAB_ORDER: TabValue[] = ['general', 'seo', 'content', 'images', 'schema']

const TAB_FIELDS: Record<TabValue, (keyof FormValues)[]> = {
  general: [
    'title', 'slug', 'categoryIds', 'tagIds', 'excerpt', 'authorProfileId',
    'scheduledPublishDate', 'scheduledPublishTime',
    'primaryCategoryId', 'isCornerstone',
  ],
  // Everything the SEO panel scores, plus the fields it scores against. Kept
  // together so the score, the checks and the inputs they judge are never on
  // opposite sides of a tab switch — a checklist you have to leave the page to
  // act on is a checklist people stop reading.
  seo: [
    'focusKeyword', 'secondaryKeywords', 'metaTitle', 'metaDescription', 'canonicalUrl', 'isIndexable',
    'seriesId', 'seriesPosition',
  ],
  content: ['content'],
  images: ['featuredImageKey', 'featuredImageAltText', 'ogImageKey'],
  schema: ['schemaType', 'schemaData', 'speakableSelectors'],
  faq: [],
}

export default function BlogPostCreateModule() {
  const adminHref = useAdminHref()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [slugTouched, setSlugTouched] = useState(false)
  const [excerptTouched, setExcerptTouched] = useState(false)
  const [isCategoryCreateOpen, setIsCategoryCreateOpen] = useState(false)
  const [isTagCreateOpen, setIsTagCreateOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabValue>('general')
  const [faqDrafts, setFaqDrafts] = useState<BlogPostFaqDraft[]>([])

  // Held from ElementEditor's onInit so the internal-link panel can write at
  // the caret. The controlled `value` can only replace the whole body, which is
  // not what "insert a link here" means.
  const editorRef = useRef<TinyMCEEditorInstance | null>(null)

  const { data: categories } = useQuery({
    queryKey: ['blog-categories-list', ''],
    queryFn: () => BlogCategoryServices.list(),
  })
  const { data: tags } = useQuery({
    queryKey: ['blog-tags-list', ''],
    queryFn: () => BlogTagServices.list(),
  })
  const { data: authors } = useQuery({
    queryKey: ['authors-list', ''],
    queryFn: () => AuthorServices.list(),
  })
  const { data: series } = useQuery({
    queryKey: ['blog-series-list', ''],
    queryFn: () => BlogSeriesServices.list(),
  })

  const categoryOptions = buildParentOptions(categories ?? [])
  const tagOptions = (tags ?? []).map((tag) => ({ label: tag.name, value: tag.id }))
  const seriesOptions = (series ?? [])
    .filter((entry) => entry.isActive)
    .map((entry) => ({ label: entry.name, value: entry.id }))
  // Inactive authors are filtered out: they stay credited on existing posts
  // but can't be picked for new ones (the API enforces the same rule).
  const authorOptions = (authors ?? [])
    .filter((author) => author.isActive)
    .map((author) => ({
      label: author.jobTitle ? `${author.name} — ${author.jobTitle}` : author.name,
      value: author.id,
    }))

  const methods = useForm<FormValues>({
    resolver: zodResolver(createBlogPostSchema),
    defaultValues: {
      title: '', slug: '', excerpt: '', content: '',
      featuredImageKey: '', featuredImageAltText: '', authorProfileId: '', categoryIds: [], tagIds: [],
      metaTitle: '', metaDescription: '', canonicalUrl: '', isPublished: false,
      ogImageKey: '', isIndexable: true,
      scheduledPublishAt: '', scheduledPublishDate: '', scheduledPublishTime: '',
      focusKeyword: '', secondaryKeywords: [], primaryCategoryId: '',
      seriesId: '', seriesPosition: undefined, isCornerstone: false,
      schemaType: 'BlogPosting', schemaData: undefined, speakableSelectors: [], schemaDrafts: {},
    },
  })

  const { handleSubmit, watch, setValue, getValues, reset, formState: { isSubmitting, errors } } = methods
  const titleValue = watch('title')
  const slugValue = watch('slug')
  const contentValue = watch('content')
  const excerptValue = watch('excerpt')

  // Nothing exists server-side yet, so this is the only copy of the draft —
  // the case where a crash costs the most. Keyed as "new"; gated on there
  // being real content so an untouched form never stores an empty draft.
  const watchedValues = watch()
  const autosave = useDraftAutosave<FormValues>({
    postId: null,
    values: watchedValues,
    enabled: !isSubmitting && (!!titleValue?.trim() || !!contentValue?.trim()),
  })

  const categoryNameById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category.name])),
    [categories]
  )
  const tagNameById = useMemo(() => new Map((tags ?? []).map((tag) => [tag.id, tag.name])), [tags])

  const primaryCategoryName =
    categoryNameById.get(watchedValues.primaryCategoryId ?? '') ??
    categoryNameById.get((watchedValues.categoryIds ?? [])[0] ?? '') ??
    null

  const seoInput: SeoAnalysisInput = {
    title: watchedValues.title ?? '',
    slug: watchedValues.slug ?? '',
    excerpt: watchedValues.excerpt ?? '',
    metaTitle: watchedValues.metaTitle,
    metaDescription: watchedValues.metaDescription,
    content: watchedValues.content ?? '',
    focusKeyword: watchedValues.focusKeyword,
    secondaryKeywords: watchedValues.secondaryKeywords,
    // `undefined` means "no featured image", which the analyser scores `na`.
    // An empty string means "has one, no alt", which fails — the distinction
    // matters and collapsing it would invent a warning on a brand-new form.
    featuredImageAltText: watchedValues.featuredImageKey
      ? (watchedValues.featuredImageAltText ?? '')
      : undefined,
    categoryNames: (watchedValues.categoryIds ?? []).map((id) => categoryNameById.get(id) ?? ''),
    tagNames: (watchedValues.tagIds ?? []).map((id) => tagNameById.get(id) ?? ''),
    faqCount: faqDrafts.length,
    isIndexable: watchedValues.isIndexable ?? true,
  }

  function handleRecoverDraft() {
    if (!autosave.recovered) return
    reset(autosave.recovered.values, { keepDefaultValues: true })
    autosave.dismissRecovered()
    // The recovered slug/excerpt came from a real edit session, so don't let
    // the auto-derive effects overwrite them.
    setSlugTouched(true)
    setExcerptTouched(true)
  }

  /** Inserts at the TinyMCE caret. False when the editor has not initialised,
   *  which happens when the Content tab has never been opened. */
  function insertAtCursor(html: string): boolean {
    const editor = editorRef.current
    if (!editor) return false
    editor.insertContent(html)
    editor.focus()
    return true
  }

  const tabErrorCounts = useMemo(() => {
    const errorKeys = Object.keys(errors)
    return {
      general: TAB_FIELDS.general.filter((f) => errorKeys.includes(f)).length,
      seo: TAB_FIELDS.seo.filter((f) => errorKeys.includes(f)).length,
      content: TAB_FIELDS.content.filter((f) => errorKeys.includes(f)).length,
      images: TAB_FIELDS.images.filter((f) => errorKeys.includes(f)).length,
      schema: TAB_FIELDS.schema.filter((f) => errorKeys.includes(f)).length,
    }
  }, [errors])

  useEffect(() => {
    if (!slugTouched) setValue('slug', slugify(titleValue || ''), { shouldValidate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleValue])

  useEffect(() => {
    if (slugValue !== slugify(titleValue || '')) setSlugTouched(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugValue])

  useEffect(() => {
    if (!excerptTouched) setValue('excerpt', suggestExcerpt(contentValue || ''), { shouldValidate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentValue])

  useEffect(() => {
    if (excerptValue !== suggestExcerpt(contentValue || '')) setExcerptTouched(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excerptValue])

  const onSubmit = async (values: FormValues) => {
    setServerErrors([])
    try {
      const { scheduledPublishDate, scheduledPublishTime, schemaDrafts, ...rest } = values
      void schemaDrafts
      const payload: CreateBlogPostFormValues = {
        ...rest,
        scheduledPublishAt: scheduledPublishDate ? `${scheduledPublishDate}T${scheduledPublishTime || '00:00'}:00` : '',
      }
      const post = await BlogPostServices.store(payload)
      // Saved server-side now, so the local backup would only produce a false
      // "unsaved changes" prompt the next time a post is created.
      autosave.clear()

      if (faqDrafts.length > 0) {
        let failedCount = 0
        for (const draft of faqDrafts) {
          try {
            await BlogPostFaqServices.store(post.id, { question: draft.question, answer: draft.answer })
          } catch {
            failedCount += 1
          }
        }
        if (failedCount > 0) {
          ElementToast.error(
            `Post created, but ${failedCount} FAQ${failedCount === 1 ? '' : 's'} failed to save. ` +
            `You can add ${failedCount === 1 ? 'it' : 'them'} again from the post's Edit page.`
          )
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['blog-posts-list'] })
      router.push(adminHref(POSTS_LIST_PATH))
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string | string[] } } }
      if (axiosErr.response?.status === 422) {
        const raw = axiosErr.response.data?.message
        setServerErrors(Array.isArray(raw) ? raw : raw ? [raw] : ['An error occurred'])
      } else {
        setServerErrors(['An error occurred'])
      }
    }
  }

  function onInvalid(invalidErrors: FieldErrors<FormValues>) {
    const errorKeys = Object.keys(invalidErrors)
    if (errorKeys.length === 0) return

    // Stay put if the tab the admin is already on has an error — jumping
    // away is disorienting when they can already see what needs fixing.
    if (TAB_FIELDS[activeTab].some((f) => errorKeys.includes(f))) return

    const target = TAB_ORDER.find((tab) => TAB_FIELDS[tab].some((f) => errorKeys.includes(f)))
    if (target) setActiveTab(target)
  }

  async function submitWithPublishState(publish: boolean) {
    setValue('isPublished', publish)
    await handleSubmit(onSubmit, onInvalid)()
  }

  async function handleCategoryCreated(category: BlogCategory) {
    await queryClient.invalidateQueries({ queryKey: ['blog-categories-list', ''] })
    const current = getValues('categoryIds') ?? []
    setValue('categoryIds', [...current, category.id], { shouldValidate: true })
  }

  async function handleTagCreated(tag: BlogTag) {
    await queryClient.invalidateQueries({ queryKey: ['blog-tags-list', ''] })
    const current = getValues('tagIds') ?? []
    setValue('tagIds', [...current, tag.id], { shouldValidate: true })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href={adminHref(POSTS_LIST_PATH)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} />
            Back to Posts
          </Link>
          <h1 className="mt-1 text-lg font-semibold">Create Blog Post</h1>
        </div>
        <div className="flex items-center gap-2">
          <ElementButton variant="cancel" onClick={() => router.push(adminHref(POSTS_LIST_PATH))} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton variant="outline" onClick={() => submitWithPublishState(false)} isLoading={isSubmitting}>
            Save as Draft
          </ElementButton>
          <ElementButton onClick={() => submitWithPublishState(true)} isLoading={isSubmitting}>
            Publish
          </ElementButton>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
        <FormProvider {...methods}>
          <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4" noValidate>
            <ValidationBox messages={serverErrors} />

            {autosave.recovered && (
              <DraftRecoveryBanner
                savedAt={autosave.recovered.savedAt}
                onRecover={handleRecoverDraft}
                onDiscard={autosave.clear}
              />
            )}

            <ElementTabs
              items={[
                { value: 'general', label: 'General', errorCount: tabErrorCounts.general },
                { value: 'seo', label: 'SEO', errorCount: tabErrorCounts.seo },
                { value: 'content', label: 'Content', errorCount: tabErrorCounts.content },
                { value: 'images', label: 'Images', errorCount: tabErrorCounts.images },
                { value: 'schema', label: 'Schema', errorCount: tabErrorCounts.schema },
                { value: 'faq', label: 'FAQ' },
              ]}
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as TabValue)}
            >
              <ElementTabs.Content value="general" className="flex flex-col gap-4">
                <div className={"w-full grid grid-cols-2 items-start gap-4"}>
                  <ElementInput
                      name="title"
                      label="Title"
                      placeholder="e.g. How to Choose the Right Deadbolt"
                      hint="The headline readers see on the post and in listings."
                      required
                  />
                  <ElementInput
                      name="slug"
                      label="Slug"
                      placeholder="how-to-choose-the-right-deadbolt"
                      hint="The post's URL ending. Auto-generated from the title — edit to override."
                      required
                  />
                </div>

                <ElementSelect
                    name="authorProfileId"
                    label="Author"
                    placeholder="Select an author"
                    hint="The byline readers see. Falls back to your admin account name if left empty. A named, credentialed author is a real ranking signal for security advice."
                    items={authorOptions}
                    clearable
                />

                <div className={"w-full grid grid-cols-2 items-start gap-4"}>
                  <ElementSelect
                      name="categoryIds"
                      label="Categories"
                      placeholder="Select categories"
                      hint="Broad sections the post belongs to. Use + to create a new one."
                      items={categoryOptions}
                      multiple
                      required
                      suffix={<AddFieldButton label="New category" onClick={() => setIsCategoryCreateOpen(true)} />}
                  />
                  <ElementSelect
                      name="tagIds"
                      label="Tags"
                      placeholder="Select tags"
                      hint="Specific keywords for cross-linking related posts. Optional."
                      items={tagOptions}
                      multiple
                      clearable
                      suffix={<AddFieldButton label="New tag" onClick={() => setIsTagCreateOpen(true)} />}
                  />
                </div>

                <PrimaryCategoryPicker categories={categories ?? []} />

                <ElementTextArea
                  name="excerpt"
                  label="Description"
                  placeholder="Short summary shown in listings"
                  hint="Short summary shown in post listings, and the fallback meta description when Meta Description is left blank. Auto-fills from the body until you edit it."
                  rows={3}
                  maxLength={300}
                  required
                />

                <ElementCheckbox
                  name="isCornerstone"
                  label="Cornerstone content"
                  hint="Mark the pillar post a whole category should link to. Cornerstone posts rank higher in related-post scoring and head up the cluster view on the posts list."
                />

                <div className={"w-full grid grid-cols-2 items-start gap-4"}>
                  <ElementDatePicker
                    name="scheduledPublishDate"
                    label="Publish Date"
                    placeholder="Publish immediately"
                    hint="Leave empty to publish immediately when you click Publish."
                    showClearButton
                  />
                  <ElementInput
                    name="scheduledPublishTime"
                    label="Publish Time"
                    type="time"
                    hint="Defaults to 00:00 if left empty."
                  />
                </div>
              </ElementTabs.Content>

              {/* The inputs the analyser scores sit alongside the score itself.
                  Splitting them would mean reading a checklist on one tab and
                  acting on it from another, which is how a checklist stops
                  getting read. */}
              <ElementTabs.Content value="seo" className="flex flex-col gap-4">
                <div className={"w-full grid grid-cols-2 items-start gap-4"}>
                  <ElementInput
                    name="focusKeyword"
                    label="Focus Keyword"
                    placeholder="e.g. deadbolt installation"
                    hint="The single query this post is written to rank for. Optional — without it the eight keyword checks below sit out rather than failing."
                    maxLength={100}
                  />
                  <SecondaryKeywordsField />
                </div>

                <ElementInput
                  name="metaTitle"
                  label="Meta Title"
                  placeholder="Overrides the page <title> for SEO"
                  hint="Title shown in Google results and browser tabs. Aim for under 60 characters."
                  maxLength={70}
                  required
                />
                <ElementTextArea
                  name="metaDescription"
                  label="Meta Description"
                  placeholder="Search-engine snippet text"
                  hint="The summary under the title in Google results. Aim for 120–160 characters."
                  maxLength={160}
                  rows={2}
                  required
                />

                <SerpPreview
                  title={watchedValues.title ?? ''}
                  metaTitle={watchedValues.metaTitle}
                  metaDescription={watchedValues.metaDescription}
                  excerpt={watchedValues.excerpt ?? ''}
                  slug={watchedValues.slug ?? ''}
                  focusKeyword={watchedValues.focusKeyword}
                  primaryCategoryName={primaryCategoryName}
                  publishedAt={null}
                />

                <ElementInput
                  name="canonicalUrl"
                  label="Canonical URL"
                  placeholder="https://flowcms.tech/blog/..."
                  hint="Only if this content is published elsewhere too — points search engines to the original."
                />

                <ElementCheckbox
                  name="isIndexable"
                  label="Allow search engines to index this post"
                  defaultValue
                  hint="Uncheck to keep the post out of Google while it stays publicly reachable. Non-indexable posts are excluded from the sitemap."
                />

                {/* Series membership is an internal-linking decision: it emits
                    a prev/next strip and a "Part N of M" line, which is
                    crawlable structure rather than a content field. */}
                <div className={"w-full grid grid-cols-2 items-start gap-4"}>
                  <ElementSelect
                    name="seriesId"
                    label="Series"
                    placeholder="Not part of a series"
                    hint="Multi-part posts get a “Part N of M” line and a previous/next strip."
                    items={seriesOptions}
                    clearable
                  />
                  <NumberField
                    name="seriesPosition"
                    label="Position in Series"
                    placeholder="1"
                    hint="Which part this is. A member with no position sorts last."
                  />
                </div>

                {/* Last, not first. The panel reports on every field above it,
                    so sitting at the top it pushed the inputs it talks about
                    below the fold — you read "rewrite the meta description"
                    and then had to scroll past the report to reach the field. */}
                <SeoPanel input={seoInput} />
              </ElementTabs.Content>

              <ElementTabs.Content value="content" className="flex flex-col gap-4">
                <ElementEditor
                  name="content"
                  label="Content"
                  placeholder="Write the post content..."
                  hint="The full body of the post. Images you insert are stored in the file manager."
                  height={480}
                  required
                  onEditorInit={(editor) => { editorRef.current = editor }}
                />

                <InternalLinkSuggestions
                  postId={null}
                  content={contentValue ?? ''}
                  onInsertLink={insertAtCursor}
                />
              </ElementTabs.Content>

              <ElementTabs.Content value="images" className="flex flex-col gap-4">
                <ElementFileSelector
                  name="featuredImageKey"
                  label="Featured Image"
                  hint="The main image shown at the top of the post and in listings."
                  accept="image"
                  required
                />

                <ElementInput
                  name="featuredImageAltText"
                  label="Image Alt Text"
                  placeholder="e.g. A deadbolt lock installed on a wooden front door"
                  hint="Describes the image for people who can't see it, and for Google Images. Don't start with 'image of'."
                  maxLength={125}
                  required
                />

                <ElementFileSelector
                  name="ogImageKey"
                  label="Social Share Image"
                  hint="Shown when the post is shared on Facebook or LinkedIn. Ideally 1200×630. Falls back to the featured image if left empty."
                  accept="image"
                />

              </ElementTabs.Content>

              <ElementTabs.Content value="schema" className="flex flex-col gap-4">
                <SchemaTab
                  preview={{
                    slug: watchedValues.slug ?? '',
                    title: watchedValues.title ?? '',
                    description: watchedValues.metaDescription || watchedValues.excerpt || '',
                    canonicalUrl: watchedValues.canonicalUrl,
                    publishedAt: null,
                    contentUpdatedAt: null,
                    primaryCategoryName,
                    tagNames: (watchedValues.tagIds ?? []).map((id) => tagNameById.get(id) ?? ''),
                    // Staged drafts, not saved rows — the post does not exist
                    // yet, but the FAQ markup is being decided on this screen.
                    faqs: faqDrafts.map((faq) => ({ question: faq.question, answer: faq.answer })),
                  }}
                />
              </ElementTabs.Content>

              <ElementTabs.Content value="faq" className="flex flex-col gap-4">
                <PostFaqTab postId={null} value={faqDrafts} onChange={setFaqDrafts} />
              </ElementTabs.Content>
            </ElementTabs>
          </form>
        </FormProvider>
      </div>

      <BlogCategoryCreateDrawer
        isOpen={isCategoryCreateOpen}
        setIsOpen={setIsCategoryCreateOpen}
        categories={categories ?? []}
        onCreated={handleCategoryCreated}
      />

      <BlogTagCreateDrawer
        isOpen={isTagCreateOpen}
        setIsOpen={setIsTagCreateOpen}
        onCreated={handleTagCreated}
      />
    </div>
  )
}
