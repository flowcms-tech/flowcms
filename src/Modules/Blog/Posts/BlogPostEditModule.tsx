'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
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
import PostFaqTab from './Components/PostFaqTab'
import PostRevisionsTab from './Components/PostRevisionsTab'
import DraftRecoveryBanner from './Components/DraftRecoveryBanner'
import PostLockBanner from './Components/PostLockBanner'
import ReviewStatusBanner from './Components/ReviewStatusBanner'
import SubmitForReviewButton from './Components/SubmitForReviewButton'
import SharePreviewButton from './Components/SharePreviewButton'
import SeoPanel, { SecondaryKeywordsField } from './Components/SeoPanel'
import SerpPreview from './Components/SerpPreview'
import SchemaTab from './Components/SchemaTab'
import InternalLinkSuggestions from './Components/InternalLinkSuggestions'
import RelatedPostsTab from './Components/RelatedPostsTab'
import PostInsightsTab from './Components/PostInsightsTab'
import { useDraftAutosave } from './Functions/useDraftAutosave'
import { usePostLock } from './Functions/usePostLock'
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
import { updateBlogPostSchema, type UpdateBlogPostFormValues } from './Values/Validations'
import { NumberField, PrimaryCategoryPicker } from './Values/BlogPostValues'
import type { SeoAnalysisInput } from './Values/seoAnalysis'
import { BlogPostServices } from './Services/BlogPostServices'
import { BlogPostFaqServices } from './Services/BlogPostFaqServices'

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
// server). They're combined into it in onSubmit and split back apart from
// post.scheduledPublishAt when the form is populated.
//
// `schemaDrafts` is UI-only too: it parks the payload of every schema type the
// editor has touched so flipping the selector to HowTo and back does not
// destroy typed-in steps. Stripped in onSubmit like the other two.
type FormValues = UpdateBlogPostFormValues & {
  scheduledPublishDate?: string
  scheduledPublishTime?: string
  schemaDrafts?: Record<string, unknown>
}

type TabValue =
  | 'general' | 'seo' | 'content' | 'images' | 'schema'
  | 'faq' | 'related' | 'insights' | 'revisions'

// Order matters: onInvalid jumps to the FIRST tab carrying an error, so this
// has to read the way an author works through the post, not alphabetically.
const TAB_ORDER: TabValue[] = ['general', 'seo', 'content', 'images', 'schema']

const TAB_FIELDS: Record<TabValue, (keyof FormValues)[]> = {
  general: [
    'title', 'slug', 'categoryIds', 'tagIds', 'excerpt', 'authorProfileId',
    'scheduledPublishDate', 'scheduledPublishTime',
    'primaryCategoryId', 'isCornerstone', 'isSubstantiveUpdate',
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
  related: [],
  insights: [],
  revisions: [],
}

interface BlogPostEditModuleProps {
  postId: string
}

export default function BlogPostEditModule({ postId }: BlogPostEditModuleProps) {
  const adminHref = useAdminHref()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [isCategoryCreateOpen, setIsCategoryCreateOpen] = useState(false)
  const [isTagCreateOpen, setIsTagCreateOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabValue>('general')

  // Held from ElementEditor's onInit so the internal-link panel can write at
  // the caret. The controlled `value` can only replace the whole body.
  const editorRef = useRef<TinyMCEEditorInstance | null>(null)

  const { data: post, isLoading: isPostLoading, refetch: refetchPost } = useQuery({
    queryKey: ['blog-post', postId],
    queryFn: () => BlogPostServices.get(postId),
  })

  const lock = usePostLock(postId)
  const isLockedByOther = lock.status === 'locked-by-other'

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
  // Same key PostFaqTab uses, so this shares its cache rather than adding a
  // request — the analyser needs the count for its FAQ check.
  const { data: faqs } = useQuery({
    queryKey: ['blog-post-faqs', postId],
    queryFn: () => BlogPostFaqServices.list(postId),
  })

  const categoryOptions = buildParentOptions(categories ?? [])
  const tagOptions = (tags ?? []).map((tag) => ({ label: tag.name, value: tag.id }))
  // An already-assigned series stays selectable even once deactivated, for the
  // same reason the author list does: opening an old post must not silently
  // drop it out of its series on save.
  const seriesOptions = (series ?? [])
    .filter((entry) => entry.isActive || entry.id === post?.seriesId)
    .map((entry) => ({ label: entry.name, value: entry.id }))
  // An already-assigned author stays selectable even once deactivated, so
  // opening an old post doesn't silently blank its byline on save.
  const authorOptions = (authors ?? [])
    .filter((author) => author.isActive || author.id === post?.authorProfileId)
    .map((author) => ({
      label: author.jobTitle ? `${author.name} — ${author.jobTitle}` : author.name,
      value: author.id,
    }))

  const methods = useForm<FormValues>({
    resolver: zodResolver(updateBlogPostSchema),
    defaultValues: {
      title: '', slug: '', excerpt: '', content: '',
      featuredImageKey: '', featuredImageAltText: '', authorProfileId: '', categoryIds: [], tagIds: [],
      metaTitle: '', metaDescription: '', canonicalUrl: '',
      ogImageKey: '', isIndexable: true,
      scheduledPublishAt: '', scheduledPublishDate: '', scheduledPublishTime: '',
      focusKeyword: '', secondaryKeywords: [], primaryCategoryId: '',
      seriesId: '', seriesPosition: undefined, isCornerstone: false,
      schemaType: 'BlogPosting', schemaData: undefined, speakableSelectors: [], schemaDrafts: {},
      isSubstantiveUpdate: false,
    },
  })

  const { handleSubmit, reset, getValues, setValue, watch, formState: { isSubmitting, errors, isDirty } } = methods

  // Autosave only once the post has loaded and the admin has actually changed
  // something — otherwise merely opening a post would store a "draft"
  // identical to what's on the server and prompt to recover it next time.
  const watchedValues = watch()
  const contentValue = watch('content')
  const autosave = useDraftAutosave<FormValues>({
    postId,
    values: watchedValues,
    enabled: !!post && isDirty && !isSubmitting && !isLockedByOther,
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
    // `undefined` means "no featured image" (scored `na`); `""` means "has one,
    // no alt" (scored fail). Collapsing the two would invent a warning.
    featuredImageAltText: watchedValues.featuredImageKey
      ? (watchedValues.featuredImageAltText ?? '')
      : undefined,
    categoryNames: (watchedValues.categoryIds ?? []).map((id) => categoryNameById.get(id) ?? ''),
    tagNames: (watchedValues.tagIds ?? []).map((id) => tagNameById.get(id) ?? ''),
    faqCount: faqs?.length,
    isIndexable: watchedValues.isIndexable ?? true,
  }

  function handleRecoverDraft() {
    if (!autosave.recovered) return
    reset(autosave.recovered.values, { keepDefaultValues: true })
    autosave.dismissRecovered()
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

  /** Overwrites the field rather than leaving the server to fill it in, so the
   *  editor sees and can edit exactly what will be saved. */
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
    if (post) {
      const scheduled = post.scheduledPublishAt ? new Date(post.scheduledPublishAt) : null
      // Parsed against the post's own schemaType. A payload that no longer
      // matches its type comes back as undefined rather than throwing — the
      // form then shows empty fields instead of a blank screen.
      let storedSchemaData: unknown
      try {
        storedSchemaData = post.schemaData ? JSON.parse(post.schemaData) : undefined
      } catch {
        storedSchemaData = undefined
      }

      reset({
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        content: post.content,
        featuredImageKey: post.featuredImageKey,
        featuredImageAltText: post.featuredImageAltText ?? '',
        authorProfileId: post.authorProfileId ?? '',
        categoryIds: post.categories.map((c) => c.id),
        tagIds: post.tags.map((t) => t.id),
        metaTitle: post.metaTitle ?? '',
        metaDescription: post.metaDescription ?? '',
        canonicalUrl: post.canonicalUrl ?? '',
        ogImageKey: post.ogImageKey ?? '',
        isIndexable: post.isIndexable ?? true,
        scheduledPublishAt: post.scheduledPublishAt ?? '',
        scheduledPublishDate: scheduled ? format(scheduled, 'yyyy-MM-dd') : '',
        scheduledPublishTime: scheduled ? format(scheduled, 'HH:mm') : '',
        focusKeyword: post.focusKeyword ?? '',
        secondaryKeywords: post.secondaryKeywords ?? [],
        primaryCategoryId: post.primaryCategoryId ?? '',
        seriesId: post.seriesId ?? '',
        seriesPosition: post.seriesPosition ?? undefined,
        isCornerstone: post.isCornerstone ?? false,
        schemaType: post.schemaType ?? 'BlogPosting',
        schemaData: storedSchemaData,
        speakableSelectors: post.speakableSelectors ?? [],
        schemaDrafts: post.schemaType ? { [post.schemaType]: storedSchemaData } : {},
        // Always false on load, never carried over from the last save. This is
        // an action, not a setting: it stamps the public "Last updated" date.
        isSubstantiveUpdate: false,
      })
    }
  }, [post, reset])

  function onInvalid(invalidErrors: FieldErrors<FormValues>) {
    const errorKeys = Object.keys(invalidErrors)
    if (errorKeys.length === 0) return

    // Stay put if the tab the admin is already on has an error — jumping
    // away is disorienting when they can already see what needs fixing.
    if (TAB_FIELDS[activeTab].some((f) => errorKeys.includes(f))) return

    const target = TAB_ORDER.find((tab) => TAB_FIELDS[tab].some((f) => errorKeys.includes(f)))
    if (target) setActiveTab(target)
  }

  const onSubmit = async (values: FormValues) => {
    setServerErrors([])
    try {
      const { scheduledPublishDate, scheduledPublishTime, schemaDrafts, ...rest } = values
      void schemaDrafts
      const payload: UpdateBlogPostFormValues = {
        ...rest,
        scheduledPublishAt: scheduledPublishDate ? `${scheduledPublishDate}T${scheduledPublishTime || '00:00'}:00` : '',
        // Absent means "leave unchanged" on a PATCH, so clearing a relation
        // needs its own flag rather than an empty string the payload sanitizer
        // would strip on the way out.
        clearSeries: !rest.seriesId,
        clearPrimaryCategory: !rest.primaryCategoryId,
      }
      await BlogPostServices.update(postId, payload)
      // The work is on the server now, so the local backup would only ever
      // produce a false "unsaved changes" prompt next time.
      autosave.clear()
      await queryClient.invalidateQueries({ queryKey: ['blog-posts-list'] })
      await queryClient.invalidateQueries({ queryKey: ['blog-post', postId] })
      await queryClient.invalidateQueries({ queryKey: ['blog-post-revisions', postId] })
      router.push(adminHref(POSTS_LIST_PATH))
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string | string[] } } }
      if (axiosErr.response?.status === 422 || axiosErr.response?.status === 409) {
        // 409 is the server-side lock guard — belt and suspenders behind the
        // disabled Save button, for the edge case where the lock was taken
        // by someone else in the moment between this page loading and the
        // click landing.
        const raw = axiosErr.response.data?.message
        setServerErrors(Array.isArray(raw) ? raw : raw ? [raw] : ['An error occurred'])
      } else {
        setServerErrors(['An error occurred'])
      }
    }
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

  const header = (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Link
          href={adminHref(POSTS_LIST_PATH)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Back to Posts
        </Link>
        <h1 className="mt-1 text-lg font-semibold">Edit Blog Post</h1>
      </div>
      <div className="flex items-center gap-3">
        {isDirty && (
          <p className="text-xs text-muted-foreground">Save to update the preview</p>
        )}
        <ElementButton variant="cancel" onClick={() => router.push(adminHref(POSTS_LIST_PATH))} disabled={isSubmitting}>
          Cancel
        </ElementButton>
        <ElementButton
          variant="outline"
          onClick={() => window.open(adminHref(`/blog/posts/${postId}/preview`), '_blank', 'noopener')}
          disabled={isPostLoading || !post}
        >
          Preview
        </ElementButton>
        {post && <SharePreviewButton postId={post.id} />}
        {post && (
          <SubmitForReviewButton
            postId={post.id}
            status={post.reviewStatus}
            onSubmitted={() => void refetchPost()}
          />
        )}
        <ElementButton
          onClick={handleSubmit(onSubmit, onInvalid)}
          isLoading={isSubmitting}
          disabled={isPostLoading || !post || isLockedByOther}
        >
          Save Changes
        </ElementButton>
      </div>
    </div>
  )

  if (!isPostLoading && !post) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="rounded-xl border border-border bg-background p-6 text-sm text-muted-foreground shadow-sm">
          Post not found.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {header}

      <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="flex flex-col gap-4" noValidate>
            <ValidationBox messages={serverErrors} />

            {post && <PostLockBanner lock={lock} />}

            {/* Above the form, not tucked into a tab: a rejection note is the
                first thing a contributor needs to see, and `none` renders
                nothing so this costs an editor's workflow nothing. */}
            {post && (
              <ReviewStatusBanner
                status={post.reviewStatus}
                reviewedByName={post.reviewedBy?.name}
                reviewedAt={post.reviewedAt}
                reviewNote={post.reviewNote}
              />
            )}

            {autosave.recovered && (
              <DraftRecoveryBanner
                savedAt={autosave.recovered.savedAt}
                onRecover={handleRecoverDraft}
                onDiscard={autosave.clear}
              />
            )}

            {/* A native <fieldset disabled> cascades to every descendant
                native form control (input/textarea/select/button) in one
                shot — covers everything below except the two custom widgets
                (TinyMCE, the file selector) that aren't native controls,
                which get an explicit `disabled` prop instead. */}
            <fieldset disabled={isLockedByOther} className="contents">

            <ElementTabs
              items={[
                { value: 'general', label: 'General', errorCount: tabErrorCounts.general },
                { value: 'seo', label: 'SEO', errorCount: tabErrorCounts.seo },
                { value: 'content', label: 'Content', errorCount: tabErrorCounts.content },
                { value: 'images', label: 'Images', errorCount: tabErrorCounts.images },
                { value: 'schema', label: 'Schema', errorCount: tabErrorCounts.schema },
                { value: 'faq', label: 'FAQ' },
                { value: 'related', label: 'Related' },
                { value: 'insights', label: 'Insights' },
                { value: 'revisions', label: 'Revisions' },
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
                    hint="The post's URL ending. Changing it breaks existing links to this post."
                    required
                  />
                </div>

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

                <PrimaryCategoryPicker categories={categories ?? []} disabled={isLockedByOther} />

                <ElementTextArea
                  name="excerpt"
                  label="Description"
                  placeholder="Short summary shown in listings"
                  hint="Short summary shown in post listings, and the fallback meta description when Meta Description is left blank."
                  rows={3}
                  maxLength={300}
                  required
                />

                <ElementSelect
                  name="authorProfileId"
                  label="Author"
                  placeholder="Select an author"
                  hint="The byline readers see. Falls back to your admin account name if left empty. A named, credentialed author is a real ranking signal for security advice."
                  items={authorOptions}
                  clearable
                />

                <ElementCheckbox
                  name="isCornerstone"
                  label="Cornerstone content"
                  hint="Mark the pillar post a whole category should link to. Cornerstone posts rank higher in related-post scoring and head up the cluster view on the posts list."
                />

                <ElementCheckbox
                  name="isSubstantiveUpdate"
                  label="This is a substantive update"
                  hint="Stamps the public “Last updated” date and the dateModified in structured data. Leave it unchecked for typo fixes and formatting — re-dating content that has not really changed is the pattern Google treats as manipulative."
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
                  <SecondaryKeywordsField disabled={isLockedByOther} />
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
                  authorName={post?.author?.name ?? null}
                  publishedAt={post?.publishedAt ?? null}
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
                    disabled={isLockedByOther}
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
                  disabled={isLockedByOther}
                  onEditorInit={(editor) => { editorRef.current = editor }}
                />

                <InternalLinkSuggestions
                  postId={postId}
                  content={contentValue ?? ''}
                  onInsertLink={insertAtCursor}
                  disabled={isLockedByOther}
                />
              </ElementTabs.Content>

              <ElementTabs.Content value="images" className="flex flex-col gap-4">
                <ElementFileSelector
                  name="featuredImageKey"
                  label="Featured Image"
                  hint="The main image shown at the top of the post and in listings."
                  accept="image"
                  required
                  disabled={isLockedByOther}
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
                  disabled={isLockedByOther}
                />

              </ElementTabs.Content>

              <ElementTabs.Content value="schema" className="flex flex-col gap-4">
                <SchemaTab
                  disabled={isLockedByOther}
                  preview={{
                    slug: watchedValues.slug ?? '',
                    title: watchedValues.title ?? '',
                    description: watchedValues.metaDescription || watchedValues.excerpt || '',
                    canonicalUrl: watchedValues.canonicalUrl,
                    publishedAt: post?.publishedAt ?? null,
                    contentUpdatedAt: post?.contentUpdatedAt ?? null,
                    authorName: post?.author?.name ?? null,
                    primaryCategoryName,
                    tagNames: (watchedValues.tagIds ?? []).map((id) => tagNameById.get(id) ?? ''),
                    imageUrl: post?.featuredImageUrl ?? null,
                    // The live page emits a FAQPage node from these, so the
                    // preview has to show it or it understates what ships.
                    faqs: (faqs ?? []).map((faq) => ({ question: faq.question, answer: faq.answer })),
                  }}
                />
              </ElementTabs.Content>

              <ElementTabs.Content value="faq" className="flex flex-col gap-4">
                <PostFaqTab postId={postId} />
              </ElementTabs.Content>

              <ElementTabs.Content value="related" className="flex flex-col gap-4">
                <RelatedPostsTab postId={postId} disabled={isLockedByOther} />
              </ElementTabs.Content>

              <ElementTabs.Content value="insights" className="flex flex-col gap-4">
                {/* Keyed off the SAVED slug, not the form field: Search Console
                    only knows about the URL that is actually live, and an
                    unsaved slug edit would query a path that does not exist. */}
                <PostInsightsTab
                  pagePath={`/blog/${post?.slug ?? ''}`}
                  publishedAt={post?.publishedAt ?? null}
                  isPublished={!!post?.isPublished}
                  content={contentValue ?? ''}
                  title={watchedValues.title ?? ''}
                  metaDescription={watchedValues.metaDescription ?? ''}
                />
              </ElementTabs.Content>

              <ElementTabs.Content value="revisions" className="flex flex-col gap-4">
                <PostRevisionsTab postId={postId} />
              </ElementTabs.Content>
            </ElementTabs>
            </fieldset>
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
