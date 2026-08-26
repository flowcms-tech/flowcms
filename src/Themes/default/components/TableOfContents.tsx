import { cn, type TocHeading } from "@/Themes/contract"

/**
 * On-page table of contents.
 *
 * Rendered only when `BlogPostView.toc.hasToc` says so (3+ headings) — below
 * that a TOC is visual noise wrapped in a box. The anchors come from
 * `buildTableOfContents`, which injects the matching ids into the body HTML in
 * the same pass, so every entry here is guaranteed to have a target.
 *
 * No client JavaScript: the mobile version is a `<details>`, which is collapsed
 * by default for free. The desktop version is a separate always-open block
 * because `open` is an HTML attribute and cannot be made responsive without JS
 * — one `display:none`'d copy is a smaller price than shipping a component
 * just to toggle a disclosure.
 */

function TocList({ headings, nested = false }: { headings: TocHeading[]; nested?: boolean }) {
  return (
    <ol className={cn("flex flex-col gap-2 text-sm", nested && "mt-2 gap-1.5 border-l border-border pl-3")}>
      {headings.map((heading) => (
        <li key={heading.id}>
          <a
            href={`#${heading.id}`}
            className={cn(
              "text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline",
              nested && "text-xs"
            )}
          >
            {heading.text}
          </a>
          {heading.children.length > 0 && <TocList headings={heading.children} nested />}
        </li>
      ))}
    </ol>
  )
}

export default function TableOfContents({
  headings,
  className,
}: {
  headings: TocHeading[]
  className?: string
}) {
  // The threshold is core's call and arrives as `toc.hasToc`; this only
  // guards the degenerate case, where there is nothing to list at all.
  if (headings.length === 0) return null

  return (
    <>
      <details className={cn("rounded-xl border border-border p-4 lg:hidden", className)}>
        <summary className="cursor-pointer text-sm font-semibold">On this page</summary>
        <nav aria-label="Table of contents" className="mt-3">
          <TocList headings={headings} />
        </nav>
      </details>

      <nav
        aria-label="Table of contents"
        className={cn(
          "hidden rounded-xl border border-border p-4 lg:sticky lg:top-24 lg:block",
          className
        )}
      >
        <p className="mb-3 text-sm font-semibold">On this page</p>
        <TocList headings={headings} />
      </nav>
    </>
  )
}
