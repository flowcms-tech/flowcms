import { sanitizePostContent } from "@/Framework/Functions/sanitizePostContent"
import type { PageView } from "@/Themes/contract/views"
import type { PublicCustomPage } from "../Queries/publicPageQueries"
import { buildPageJsonLd } from "../Values/buildPageJsonLd"

/**
 * Everything the Page surface renders, resolved before the theme is reached.
 *
 * Same shape as the Phase 6.0 blog view models and for the same reason: a
 * theme that has to sanitise its own HTML or author its own JSON-LD is a theme
 * that can get either wrong on the public site.
 *
 * Synchronous — unlike the blog builders it has no follow-up queries to make.
 */
export function buildPageView(page: PublicCustomPage): PageView {
  return {
    page,
    jsonLd: buildPageJsonLd(page),
    // Content is sanitised on write too, so this is defence in depth rather
    // than the primary guard — the same convention the post body follows.
    html: sanitizePostContent(page.content),
  }
}
