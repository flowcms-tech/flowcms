import sanitizeHtml from "sanitize-html"

/**
 * Post bodies are TinyMCE HTML and are rendered with `dangerouslySetInnerHTML`
 * on the public page. Authors are trusted admins, so this is defence in depth
 * rather than a live hole — but sanitizing on WRITE means the stored value is
 * always safe and the render path stays cheap (no per-request parse).
 *
 * The allowlist covers what the configured TinyMCE toolbar can actually
 * produce. `id` is permitted on headings because the table-of-contents work
 * (spec Phase 2.4) will anchor to them.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr", "blockquote", "pre", "code",
    "strong", "b", "em", "i", "u", "s", "sub", "sup", "span", "div",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
    "a", "img", "figure", "figcaption", "iframe",
  ],
  allowedAttributes: {
    "*": ["style", "class", "dir"],
    h1: ["id"], h2: ["id"], h3: ["id"], h4: ["id"], h5: ["id"], h6: ["id"],
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    iframe: ["src", "width", "height", "allow", "allowfullscreen", "title", "frameborder"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
    col: ["span"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  // Video embeds only — an arbitrary iframe src is an open redirect surface.
  allowedIframeHostnames: ["www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "player.vimeo.com"],
  allowProtocolRelative: false,
  // Drops <script>/<style> contents entirely rather than leaving the text behind.
  nonTextTags: ["script", "style", "textarea", "option", "noscript"],
}

export function sanitizePostContent(html: string): string {
  return sanitizeHtml(html, OPTIONS)
}

/** Plain text for FAQ answers in JSON-LD, which must not contain markup. */
export function htmlToPlainText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim()
}
