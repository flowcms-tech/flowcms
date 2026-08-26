import Link from "next/link"
import PostMeta from "./components/PostMeta"
import RelatedPosts from "./components/RelatedPosts"
import SeriesNavigation, { SeriesPartLine } from "./components/SeriesNavigation"
import TableOfContents from "./components/TableOfContents"
import ReaderQuestions from "./components/ReaderQuestions"
import {
  JsonLd,
  cn,
  howToStepAnchor,
  publicImageUrl,
  type BlogPostView,
} from "@/Themes/contract"

/**
 * The public article page. Props in, JSX out.
 *
 * It used to fetch its own related posts and series parts and build its own
 * JSON-LD. Phase 6.0 moved both into `ViewModels/buildBlogPostView`, because a
 * component that queries and authors structured data cannot be replaced by a
 * theme — every theme author would inherit both jobs, and the second one is
 * FlowCMS's SEO correctness.
 */
export default function BlogPost(view: BlogPostView) {
  const {
    post,
    questions,
    related,
    seriesPosts,
    toc: { html, headings, hasToc },
    primaryCategory,
    howTo,
    review,
    video,
    askQuestion,
    jsonLd,
  } = view

  return (
    <article className={cn("mx-auto w-full max-w-3xl px-4 py-12", hasToc && "lg:max-w-5xl")}>
      <JsonLd data={jsonLd} />

      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
        <Link href="/blog" className="hover:underline">
          Blog
        </Link>
        {primaryCategory && (
          <>
            <span aria-hidden> / </span>
            <Link href={`/blog/category/${primaryCategory.slug}`} className="hover:underline">
              {primaryCategory.name}
            </Link>
          </>
        )}
      </nav>

      <header className="mb-6 flex flex-col gap-3">
        <h1 className="text-3xl font-bold leading-tight">{post.title}</h1>
        <PostMeta
          author={post.author}
          publishedAt={post.publishedAt}
          wordCount={post.wordCount}
          contentUpdatedAt={post.contentUpdatedAt}
        />
        {post.series && (
          <SeriesPartLine series={post.series} posts={seriesPosts} currentPostId={post.id} />
        )}
      </header>

      {/* eslint-disable-next-line @next/next/no-img-element -- served by our own
          public image route, not an optimizable remote pattern */}
      <img
        src={post.featuredImageUrl}
        alt={post.featuredImageAltText}
        width={1200}
        height={630}
        className="mb-8 aspect-[1200/630] w-full rounded-xl object-cover"
      />

      {/* The TOC sits in column 2 on desktop so it can be sticky — a sticky
          element stacked above the body in a single column would cover the
          text it is meant to help you navigate. It is first in the DOM so the
          mobile <details> lands above the article, where a TOC belongs. */}
      <div
        className={cn(
          "flex flex-col gap-8",
          hasToc && "lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start lg:gap-10"
        )}
      >
        {hasToc && <TableOfContents headings={headings} className="lg:col-start-2 lg:row-start-1" />}

        {/* Safe: content is sanitized on write (sanitizePostContent), so the
            render path never has to parse or clean it. */}
        <div
          className={cn(
            "prose prose-neutral max-w-none dark:prose-invert",
            hasToc && "lg:col-start-1 lg:row-start-1"
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

      {/* HowTo steps RENDER. They are not a markup-only enhancement: Google
          penalises structured data describing content the visitor cannot see,
          so the same parsed payload feeds both this list and the JSON-LD, and
          there is deliberately no path that emits one without the other. */}
      {howTo && (
        <section className="mt-12" aria-labelledby="howto-heading">
          <h2 id="howto-heading" className="mb-4 text-xl font-semibold">
            Step by step
          </h2>

          {(howTo.totalTime || howTo.estimatedCost) && (
            <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              {howTo.totalTime && (
                <div>
                  <dt className="text-muted-foreground">Time needed</dt>
                  <dd className="font-medium">{howTo.totalTime}</dd>
                </div>
              )}
              {howTo.estimatedCost && (
                <div>
                  <dt className="text-muted-foreground">Estimated cost</dt>
                  <dd className="font-medium">{howTo.estimatedCost}</dd>
                </div>
              )}
            </dl>
          )}

          {(howTo.tools.length > 0 || howTo.supplies.length > 0) && (
            <div className="mb-6 grid gap-4 sm:grid-cols-2">
              {howTo.tools.length > 0 && (
                <div className="rounded-lg border border-border p-4">
                  <p className="mb-2 text-sm font-medium">Tools</p>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
                    {howTo.tools.map((tool) => (
                      <li key={tool}>{tool}</li>
                    ))}
                  </ul>
                </div>
              )}
              {howTo.supplies.length > 0 && (
                <div className="rounded-lg border border-border p-4">
                  <p className="mb-2 text-sm font-medium">Supplies</p>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
                    {howTo.supplies.map((supply) => (
                      <li key={supply}>{supply}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <ol className="flex list-decimal flex-col gap-6 pl-5">
            {howTo.steps.map((step, index) => (
              // The same anchor the HowToStep's `url` points at, so a jump link
              // from a search result lands on the step it names.
              <li key={`${step.name}-${index}`} id={howToStepAnchor(index)}>
                <p className="font-medium">{step.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
                {step.imageKey && (
                  // eslint-disable-next-line @next/next/no-img-element -- our own public image route
                  <img
                    src={publicImageUrl(step.imageKey)}
                    alt={step.name}
                    loading="lazy"
                    className="mt-3 w-full rounded-lg border border-border object-cover"
                  />
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Same rule as the HowTo block: a rating asserted in markup has to be a
          rating the reader can see. */}
      {review && (
        <section className="mt-12 rounded-xl border border-border p-4" aria-labelledby="review-heading">
          <h2 id="review-heading" className="text-xl font-semibold">
            {review.itemName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Rated {review.rating} out of {review.bestRating}
          </p>

          {(review.pros.length > 0 || review.cons.length > 0) && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {review.pros.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Pros</p>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
                    {review.pros.map((pro) => (
                      <li key={pro}>{pro}</li>
                    ))}
                  </ul>
                </div>
              )}
              {review.cons.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Cons</p>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
                    {review.cons.map((con) => (
                      <li key={con}>{con}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* A VideoObject node claims the video is this page's main entity, so the
          page has to offer it. The link is the minimum honest rendering — the
          editor embeds the player in the body when the platform allows it. */}
      {video && (
        <section className="mt-12 rounded-xl border border-border p-4" aria-labelledby="video-heading">
          <h2 id="video-heading" className="text-sm font-semibold">
            Watch
          </h2>
          <a
            href={video.contentUrl}
            rel="noopener"
            target="_blank"
            className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            {post.title}
          </a>
          {video.duration && (
            <p className="mt-1 text-xs text-muted-foreground">Duration {video.duration}</p>
          )}
        </section>
      )}

      {/* The FAQ must stay visible — buildPostJsonLd emits FAQPage markup for
          these, and structured data describing hidden content is a
          manual-action risk. */}
      {post.faqs.length > 0 && (
        <section className="mt-12" aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="mb-4 text-xl font-semibold">
            Frequently asked questions
          </h2>
          <dl className="flex flex-col gap-4">
            {post.faqs.map((faq) => (
              <div key={faq.id} className="rounded-lg border border-border p-4">
                <dt className="font-medium">{faq.question}</dt>
                <dd className="mt-2 text-sm text-muted-foreground">{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Same visibility rule as the FAQ block above: these entries are in the
          FAQPage graph, so they have to be on the page. */}
      <ReaderQuestions questions={questions} />

      {/* Core builds the form; the theme decides placement and spacing. See
          `BlogPostView.askQuestion` for why it is a slot rather than an import. */}
      <div className="mt-12">{askQuestion}</div>

      {post.series && (
        <SeriesNavigation series={post.series} posts={seriesPosts} currentPostId={post.id} />
      )}

      {/* Author card. Only rendered for a real author — the admin-account
          fallback has no credentials worth showing, and an empty card reads
          worse than none. Mirrors the Person in the JSON-LD above. */}
      {post.author.isRealAuthor && (
        <section className="mt-12 flex gap-4 rounded-xl border border-border p-4">
          {post.author.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- our own public image route
            <img
              src={post.author.avatarUrl}
              alt={post.author.avatarAltText ?? post.author.name}
              width={64}
              height={64}
              className="size-16 shrink-0 rounded-full object-cover"
            />
          )}
          <div className="flex flex-col gap-1">
            <p className="font-semibold">
              {post.author.slug ? (
                <Link href={`/blog/author/${post.author.slug}`} className="hover:underline">
                  {post.author.name}
                </Link>
              ) : (
                post.author.name
              )}
            </p>
            {post.author.jobTitle && (
              <p className="text-sm text-muted-foreground">{post.author.jobTitle}</p>
            )}
            {post.author.credentials && (
              <p className="text-xs text-muted-foreground">{post.author.credentials}</p>
            )}
            {post.author.bio && <p className="mt-1 text-sm">{post.author.bio}</p>}
          </div>
        </section>
      )}

      <RelatedPosts posts={related} />

      {post.tags.length > 0 && (
        <footer className="mt-12 flex flex-wrap items-center gap-2 border-t border-border pt-6">
          <span className="text-sm text-muted-foreground">Tags:</span>
          {post.tags.map((tag) => (
            <Link
              key={tag.id}
              href={`/blog/tag/${tag.slug}`}
              className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-muted"
            >
              {tag.name}
            </Link>
          ))}
        </footer>
      )}
    </article>
  )
}
