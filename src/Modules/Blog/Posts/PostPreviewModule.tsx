'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Monitor, Smartphone } from 'lucide-react'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import { BlogPostServices } from './Services/BlogPostServices'
import { BlogPostFaqServices } from './Services/BlogPostFaqServices'
import { AuthorServices } from '@/Modules/Authors/Services/AuthorServices'
import { sameAsLinks } from '@/Modules/Authors/Values/AuthorValues'

/**
 * Admin-only "what this post will actually look like" preview.
 *
 * Deliberately does not reuse src/Modules/Blog/Public — that module builds
 * its images through the public, presign-free image route, which only
 * serves keys already referenced by a *published* post. A draft's featured
 * image would 404 through that path. This renders from the same admin
 * payload the edit form already uses (presigned URLs, always resolvable
 * regardless of publish state) instead.
 *
 * Category and tag chips are shown as plain badges, not links: the admin
 * post payload carries {id, name} for each, not the slug the public site's
 * URLs need. Good enough for "does this look right", not a live nav mock.
 */

function formatDate(value: string | null): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'long' }).format(new Date(value))
}

export default function PostPreviewModule({ postId }: { postId: string }) {
  const adminHref = useAdminHref()
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')

  const { data: post, isLoading } = useQuery({
    queryKey: ['blog-post', postId],
    queryFn: () => BlogPostServices.get(postId),
  })

  const { data: faqs } = useQuery({
    queryKey: ['blog-post-faqs', postId],
    queryFn: () => BlogPostFaqServices.list(postId),
  })

  const { data: fullAuthor } = useQuery({
    queryKey: ['author', post?.authorProfileId],
    queryFn: () => AuthorServices.get(post!.authorProfileId!),
    enabled: !!post?.authorProfileId,
  })

  const editUrl = adminHref(`/blog/posts/${postId}/edit`)

  if (isLoading || !post) {
    return (
      <div className="flex flex-col gap-4">
        <Link href={editUrl} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} />
          Back to Edit
        </Link>
        <p className="text-sm text-muted-foreground">Loading preview…</p>
      </div>
    )
  }

  const status = post.deletedAt
    ? { label: 'In the trash', variant: 'destructive' as const, note: 'Restore this post before it can go live again.' }
    : post.isPublished
      ? { label: 'Published', variant: 'success' as const, note: 'This is how the live post currently looks.' }
      : post.scheduledPublishAt
        ? { label: 'Scheduled', variant: 'info' as const, note: `Goes live ${formatDate(post.scheduledPublishAt)}. This preview shows the draft.` }
        : { label: 'Draft', variant: 'warning' as const, note: 'Not visible to the public yet.' }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={editUrl} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft size={14} />
          Back to Edit
        </Link>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => setViewport('desktop')}
              aria-pressed={viewport === 'desktop'}
              title="Desktop width"
              className={`rounded-md p-1.5 transition-colors ${viewport === 'desktop' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Monitor size={15} />
            </button>
            <button
              type="button"
              onClick={() => setViewport('mobile')}
              aria-pressed={viewport === 'mobile'}
              title="Mobile width"
              className={`rounded-md p-1.5 transition-colors ${viewport === 'mobile' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Smartphone size={15} />
            </button>
          </div>
          {post.isPublished && !post.deletedAt && (
            <ElementButton
              variant="outline"
              size="sm"
              onClick={() => window.open(`/blog/${post.slug}`, '_blank', 'noopener')}
            >
              View Live
            </ElementButton>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-3">
        <ElementBadge variant={status.variant}>{status.label}</ElementBadge>
        <p className="text-sm text-muted-foreground">{status.note}</p>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4 sm:p-8">
        <div className={`mx-auto transition-[max-width] ${viewport === 'mobile' ? 'max-w-sm' : 'max-w-3xl'}`}>
          <article className="rounded-xl border border-border bg-background p-6 shadow-sm">
            <nav className="mb-6 text-sm text-muted-foreground">
              Blog
              {post.categories[0] && (
                <>
                  <span aria-hidden> / </span>
                  {post.categories[0].name}
                </>
              )}
            </nav>

            <header className="mb-6 flex flex-col gap-3">
              <h1 className="text-3xl font-bold leading-tight">{post.title || 'Untitled post'}</h1>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {(fullAuthor?.name || post.author?.name) && <span>{fullAuthor?.name ?? post.author?.name}</span>}
                {post.publishedAt && (
                  <>
                    <span aria-hidden>·</span>
                    <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                  </>
                )}
              </div>
            </header>

            {post.featuredImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- presigned admin URL, not an optimizable remote pattern
              <img
                src={post.featuredImageUrl}
                alt={post.featuredImageAltText ?? post.title}
                className="mb-8 aspect-[1200/630] w-full rounded-xl object-cover"
              />
            )}

            {post.content ? (
              <div
                className="prose prose-neutral max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: post.content }}
              />
            ) : (
              <p className="text-sm italic text-muted-foreground">No content yet.</p>
            )}

            {faqs && faqs.length > 0 && (
              <section className="mt-12" aria-labelledby="preview-faq-heading">
                <h2 id="preview-faq-heading" className="mb-4 text-xl font-semibold">
                  Frequently asked questions
                </h2>
                <dl className="flex flex-col gap-4">
                  {faqs.map((faq) => (
                    <div key={faq.id} className="rounded-lg border border-border p-4">
                      <dt className="font-medium">{faq.question}</dt>
                      <dd className="mt-2 text-sm text-muted-foreground">{faq.answer}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {fullAuthor && (
              <section className="mt-12 flex gap-4 rounded-xl border border-border p-4">
                {fullAuthor.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- presigned admin URL
                  <img
                    src={fullAuthor.avatarUrl}
                    alt={fullAuthor.avatarAltText ?? fullAuthor.name}
                    className="size-16 shrink-0 rounded-full object-cover"
                  />
                )}
                <div className="flex flex-col gap-1">
                  <p className="font-semibold">{fullAuthor.name}</p>
                  {fullAuthor.jobTitle && (
                    <p className="text-sm text-muted-foreground">{fullAuthor.jobTitle}</p>
                  )}
                  {fullAuthor.credentials && (
                    <p className="text-xs text-muted-foreground">{fullAuthor.credentials}</p>
                  )}
                  {fullAuthor.bio && <p className="mt-1 text-sm">{fullAuthor.bio}</p>}
                  {sameAsLinks(fullAuthor).length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {sameAsLinks(fullAuthor).length} profile link{sameAsLinks(fullAuthor).length === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
              </section>
            )}

            {post.tags.length > 0 && (
              <footer className="mt-12 flex flex-wrap items-center gap-2 border-t border-border pt-6">
                <span className="text-sm text-muted-foreground">Tags:</span>
                {post.tags.map((tag) => (
                  <ElementBadge key={tag.id} variant="outline">
                    {tag.name}
                  </ElementBadge>
                ))}
              </footer>
            )}
          </article>
        </div>
      </div>
    </div>
  )
}
