import type { PublicCustomPage } from "../Queries/publicPageQueries"

/**
 * The WebPage node for a custom page.
 *
 * Lifted out of `CustomPageModule` in Phase 6.1. It was assembled inline in the
 * component, which made structured data a presentation concern — so every
 * future theme would have inherited the job of getting schema.org right, and an
 * operator switching themes could silently change what their site claims.
 * Core owns the graph; the theme only decides where to put the script tag.
 *
 * `dateModified` only, which is exactly what the component emitted. The lift is
 * behaviour-preserving on purpose — Phase 6.0 pinned this project's structured
 * data precisely so a refactor could be shown not to have changed it, and an
 * "improvement" smuggled in alongside a move is an improvement nobody reviewed.
 *
 * The pages table does carry a nullable `publishedAt`, so a `datePublished`
 * could be emitted here. Adding it is an SEO change and belongs in an SEO
 * change, not in a theme extraction.
 */
export function buildPageJsonLd(page: PublicCustomPage): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.title,
    ...(page.metaDescription ? { description: page.metaDescription } : {}),
    dateModified: page.updatedAt.toISOString(),
  }
}
