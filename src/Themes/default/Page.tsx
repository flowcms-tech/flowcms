import { JsonLd, type PageView } from "@/Themes/contract"

/**
 * A custom page.
 *
 * The body arrives already sanitised, and the JSON-LD arrives already built —
 * this component used to do both itself, and the JSON-LD half was once a raw
 * `JSON.stringify` that a page title of `</script><script>…` escaped from.
 */
export default function Page({ page, jsonLd, html }: PageView) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12">
      <JsonLd data={jsonLd} />

      <h1 className="mb-6 text-3xl font-bold leading-tight">{page.title}</h1>

      <div
        className="prose prose-neutral max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  )
}
