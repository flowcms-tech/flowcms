'use client'

import { useAdminPath } from "@/Framework/Config/AdminPathProvider"
import { useEffect, useMemo, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementToast from '@/components/shared/ElementToast/ElementToast'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import SettingsShell from '@/Modules/Settings/Components/SettingsShell'
import { SettingsServices } from '@/Modules/Settings/Services/SettingsServices'
import { SeoServices } from '@/Modules/Settings/Services/SeoServices'
import {
  updateSiteSettingsSchema,
  META_TEMPLATE_VARIABLES,
  type UpdateSiteSettingsFormValues,
} from '@/Modules/Settings/Values/Validations'
import { buildRobotsPreview } from '@/Modules/Settings/Values/robotsRules'

const EMPTY: UpdateSiteSettingsFormValues = {
  metaTitleTemplate: '', metaDescriptionTemplate: '', categoryTitleTemplate: '',
  tagTitleTemplate: '', authorTitleTemplate: '', titleSeparator: '',
  externalLinkRel: '', externalLinkNewTab: true,
  indexNowEnabled: false, googleIndexingApiEnabled: false, newsSitemapEnabled: false,
  robotsExtraRules: '', robotsExtraSitemaps: '',
}

/** What each %variable% resolves to, shown inline so an editor doesn't have to
 *  guess whether %category% means one category or all of them. */
const VARIABLE_MEANINGS: Record<string, string> = {
  '%title%': 'the post or archive title',
  '%sitename%': 'the site name from the Global tab',
  '%sep%': 'the title separator below',
  '%excerpt%': "the post's excerpt",
  '%category%': 'all linked categories, comma-separated',
  '%primary_category%': 'the post’s primary category only',
  '%tag%': 'all linked tags, comma-separated',
  '%author%': 'the author’s display name',
  '%date%': 'published date',
  '%modified%': 'last substantive update',
  '%focus_keyword%': 'the post’s focus keyword',
  '%page%': 'page number on paginated archives',
}

export default function SeoSettingsModule() {
  const adminRoot = useAdminPath()
  const queryClient = useQueryClient()
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [isGeneratingKey, setIsGeneratingKey] = useState(false)

  const { data: settings, isLoading } = useQuery({
    queryKey: ['global-settings'],
    queryFn: SettingsServices.get,
  })

  const methods = useForm<UpdateSiteSettingsFormValues>({
    resolver: zodResolver(updateSiteSettingsSchema),
    defaultValues: EMPTY,
  })

  const { handleSubmit, reset, watch, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (settings) {
      reset({
        metaTitleTemplate: settings.metaTitleTemplate,
        metaDescriptionTemplate: settings.metaDescriptionTemplate,
        categoryTitleTemplate: settings.categoryTitleTemplate,
        tagTitleTemplate: settings.tagTitleTemplate,
        authorTitleTemplate: settings.authorTitleTemplate,
        titleSeparator: settings.titleSeparator,
        externalLinkRel: settings.externalLinkRel,
        externalLinkNewTab: settings.externalLinkNewTab,
        indexNowEnabled: settings.indexNowEnabled,
        googleIndexingApiEnabled: settings.googleIndexingApiEnabled,
        newsSitemapEnabled: settings.newsSitemapEnabled,
        robotsExtraRules: settings.robotsExtraRules,
        robotsExtraSitemaps: settings.robotsExtraSitemaps,
      })
    }
  }, [settings, reset])

  const extraRules = watch('robotsExtraRules')
  const extraSitemaps = watch('robotsExtraSitemaps')

  // Renders the file byte-for-byte from the same builder robots.ts uses, so
  // the owner can see that their extra lines are *added to* the core rules
  // rather than replacing them — the misunderstanding that leads to someone
  // typing "Disallow: /" thinking they're scoping something narrower.
  const robotsPreview = useMemo(
    () =>
      buildRobotsPreview({
        sitemapUrl: `${(settings?.baseUrl ?? '').replace(/\/$/, '')}/sitemap.xml`,
        adminRoot,
        extraRules,
        extraSitemaps,
      }),
    [settings?.baseUrl, adminRoot, extraRules, extraSitemaps]
  )

  const onSubmit = async (values: UpdateSiteSettingsFormValues) => {
    setServerErrors([])
    try {
      const updated = await SettingsServices.update(values)
      queryClient.setQueryData(['global-settings'], updated)
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

  const handleGenerateIndexNowKey = async () => {
    setIsGeneratingKey(true)
    try {
      await SeoServices.generateIndexNowKey()
      // Refetch rather than trust the response body — the key lands on the
      // settings row, and this screen already knows how to render that.
      await queryClient.invalidateQueries({ queryKey: ['global-settings'] })
      ElementToast.success('IndexNow key generated')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string | string[] } } }
      const raw = axiosErr.response?.data?.message
      ElementToast.error(
        Array.isArray(raw) ? raw.join(', ') : raw || 'Could not generate an IndexNow key.'
      )
    } finally {
      setIsGeneratingKey(false)
    }
  }

  return (
    <SettingsShell
      description="Title and description templates, link policy, and how this site tells search engines it has changed. Every field here is optional — blank means the built-in default."
      onSave={handleSubmit(onSubmit)}
      isSaving={isSubmitting}
    >
      {isLoading || !settings ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
            <ValidationBox messages={serverErrors} />

            <section className="flex flex-col gap-4">
              <div>
                <h2 className="text-sm font-semibold">Meta templates</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Used only where a post, category, tag, or author has no title or description of its
                  own. A per-item value always wins — templates fill blanks, they never override.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-sm font-medium">Available variables</p>
                <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                  {META_TEMPLATE_VARIABLES.map((variable) => (
                    <li key={variable} className="flex items-baseline gap-2 text-xs">
                      <code className="shrink-0 rounded bg-background px-1 py-0.5 text-foreground">
                        {variable}
                      </code>
                      <span className="text-muted-foreground">{VARIABLE_MEANINGS[variable]}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  A variable with nothing behind it renders as empty, and the leftover separator and
                  spacing are collapsed — so a post with no category never produces “Title | | Site”.
                </p>
              </div>

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementInput
                  name="metaTitleTemplate"
                  label="Post Title Template"
                  placeholder="%title% %sep% %sitename%"
                  hint="Applied when a post leaves its SEO title blank."
                />
                <ElementInput
                  name="titleSeparator"
                  label="Title Separator"
                  placeholder="|"
                  maxLength={5}
                  hint="What %sep% renders as. Common choices: | - – •"
                />
              </div>

              <ElementInput
                name="metaDescriptionTemplate"
                label="Post Description Template"
                placeholder="%excerpt%"
                hint="Applied when a post leaves its meta description blank. Keep the result near 120–160 characters."
              />

              <div className="w-full grid grid-cols-3 items-start gap-4">
                <ElementInput
                  name="categoryTitleTemplate"
                  label="Category Archive Title"
                  placeholder="%title% %sep% %sitename%"
                />
                <ElementInput
                  name="tagTitleTemplate"
                  label="Tag Archive Title"
                  placeholder="%title% %sep% %sitename%"
                />
                <ElementInput
                  name="authorTitleTemplate"
                  label="Author Archive Title"
                  placeholder="%title% %sep% %sitename%"
                />
              </div>
            </section>

            <section className="flex flex-col gap-4 border-t border-border pt-6">
              <div>
                <h2 className="text-sm font-semibold">External links</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Applied when post content is saved, not when it is displayed. A hand-set
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">rel=&quot;sponsored&quot;</code>
                  or <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">rel=&quot;ugc&quot;</code>
                  is left alone — marking a paid link is a disclosure, and it must not be silently
                  rewritten.
                </p>
              </div>

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementInput
                  name="externalLinkRel"
                  label="rel Attribute"
                  placeholder="nofollow noopener"
                  hint="Space-separated. Links to this site's own pages never get these."
                />
                <div className="pt-6">
                  <ElementCheckbox
                    name="externalLinkNewTab"
                    label="Open external links in a new tab"
                    hint="Adds target=&quot;_blank&quot; to outbound links only."
                  />
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-4 border-t border-border pt-6">
              <h2 className="text-sm font-semibold">Indexing</h2>

              <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
                <ElementCheckbox
                  name="indexNowEnabled"
                  label="Enable IndexNow"
                  hint="Notifies Bing, Yandex, Seznam, and Naver the moment a post is published, updated, or removed."
                />
                <p className="text-sm text-muted-foreground">
                  The recommended way to get changes picked up quickly: free, no OAuth, one request.
                  Note that Google does not participate in IndexNow — for Google, a correct sitemap
                  is what does the work.
                </p>

                <div className="flex flex-wrap items-center gap-3">
                  <ElementButton
                    type="button"
                    variant="cancel"
                    onClick={handleGenerateIndexNowKey}
                    isLoading={isGeneratingKey}
                  >
                    <KeyRound size={14} />
                    {settings.indexNowKey ? 'Regenerate key' : 'Generate key'}
                  </ElementButton>

                  {settings.indexNowKey ? (
                    <code className="break-all rounded bg-muted px-2 py-1 text-xs">
                      {settings.indexNowKey}
                    </code>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      No key yet — IndexNow cannot submit anything until one exists.
                    </span>
                  )}
                </div>

                {settings.indexNowKey && (
                  <p className="text-xs text-muted-foreground">
                    Served publicly at
                    <code className="mx-1 rounded bg-muted px-1 py-0.5">/api/public/indexnow-key.txt</code>
                    and passed as <code className="rounded bg-muted px-1 py-0.5">keyLocation</code>,
                    which is how search engines verify the submission is really from this site. The
                    key is not a secret. Regenerating it invalidates the old one immediately.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
                <ElementCheckbox
                  name="googleIndexingApiEnabled"
                  label="Enable the Google Indexing API"
                  hint="Off by default, and it should almost certainly stay off — read the note below."
                />
                <p className="text-sm text-muted-foreground">
                  Google officially supports the Indexing API only for
                  <strong className="mx-1 text-foreground">JobPosting</strong>
                  and
                  <strong className="mx-1 text-foreground">BroadcastEvent</strong>
                  content. Using it for blog posts is outside its documented scope and is
                  unreliable — Google has said so repeatedly, and sites that depend on it are
                  depending on a side effect that can stop working without notice. IndexNow above,
                  plus a correct sitemap, is the recommended path.
                </p>
              </div>

              <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
                <ElementCheckbox
                  name="newsSitemapEnabled"
                  label="Publish a Google News sitemap"
                  hint="Does nothing unless this site is an approved Google News publisher."
                />
                <p className="text-sm text-muted-foreground">
                  A news sitemap has no effect without approved Google News publisher status, and by
                  specification it may only ever contain articles from the
                  <strong className="mx-1 text-foreground">last 48 hours</strong>
                  — so it is empty most of the time by design. Enable it only if the publisher
                  application has actually been accepted.
                </p>
              </div>
            </section>

            <section className="flex flex-col gap-4 border-t border-border pt-6">
              <div>
                <h2 className="text-sm font-semibold">robots.txt</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  These lines are <em>added to</em> the generated rules, which always emit. There is
                  deliberately no way to replace the whole file from here: a single stray
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">Disallow: /</code>
                  removes the entire site from every search engine, and because pages drop out
                  gradually you would find out weeks later from missing traffic.
                </p>
              </div>

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementTextArea
                  name="robotsExtraRules"
                  label="Extra Rules"
                  rows={6}
                  placeholder={'Disallow: /private/\nAllow: /private/public-file.pdf'}
                  hint="One directive per line: Allow, Disallow, or Crawl-delay. Lines starting with # are comments."
                />
                <ElementTextArea
                  name="robotsExtraSitemaps"
                  label="Extra Sitemaps"
                  rows={6}
                  placeholder={'https://example.com/other-sitemap.xml'}
                  hint="One full URL per line. The site's own sitemap is already included."
                />
              </div>

              <div>
                <p className="text-sm font-medium">Preview — what will be served</p>
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed">
                  {robotsPreview}
                </pre>
                <p className="mt-1 text-xs text-muted-foreground">
                  Invalid lines are left out of both the preview and the real file. Fix the errors
                  shown on the fields above and they will appear here.
                </p>
              </div>
            </section>
          </form>
        </FormProvider>
      )}
    </SettingsShell>
  )
}
