import Link from "next/link"
import { JsonLd, type HomeView } from "@/Themes/contract"

/**
 * The site root.
 *
 * Still a placeholder rather than a design: it names the site from Settings,
 * emits the LocalBusiness graph core built if — and only if — a business
 * profile has been configured, and points at the blog. Giving it a proper
 * front page is a design job, not a plumbing one, and it can now be done by
 * replacing this one file.
 *
 * It renders the site name from Settings rather than hardcoding "FlowCMS" so
 * the first thing an operator configures is visible immediately.
 */
export default function Home({ brand, jsonLd }: HomeView) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
      {/* Null on an unconfigured install — core omits the node rather than
          emitting one built out of nulls. */}
      {jsonLd ? <JsonLd data={jsonLd} /> : null}

      <h1 className="text-2xl font-semibold">{brand.siteName}</h1>
      {brand.tagline ? <p className="mt-2 text-muted-foreground">{brand.tagline}</p> : null}
      <p className="mt-6 max-w-prose text-sm text-muted-foreground">
        This site has no front page yet. Published content is available under{" "}
        <Link className="underline underline-offset-4" href="/blog">
          /blog
        </Link>
        .
      </p>
    </div>
  )
}
