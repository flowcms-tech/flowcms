/**
 * Baseline response headers for a self-hosted CMS.
 *
 * Lives here rather than inline in `next.config.ts` so it can be unit-tested:
 * a header policy that nobody can assert against drifts silently, and the
 * failure mode of getting one wrong is either "no protection" or "the whole
 * site is blank", neither of which announces itself.
 */

export type CspMode = "enforce" | "report-only" | "off"

/**
 * The policy, as directives.
 *
 * WHY `'unsafe-inline'` IS IN `script-src`, STATED PLAINLY
 *
 * Next's App Router inlines bootstrap scripts and streams the RSC payload
 * through inline `<script>` tags on every page. The strict answer is a
 * per-request nonce, which requires generating the header per request — and
 * `next.config.ts` headers are static, computed once at build. Emitting them
 * from `src/proxy.ts` is not an option either: its matcher is
 * the admin namespace only, and widening it would put the public blog behind the
 * `authorized` callback, i.e. behind the login screen.
 *
 * So the honest position is: this policy meaningfully constrains where scripts
 * may be LOADED from (`'self'` only — no CDN, no attacker-hosted bundle) and
 * removes plugins, base-tag hijacking, and cross-origin form posts, but it does
 * not stop injected inline script. It is a real reduction in attack surface and
 * it is not XSS-proof. Nonce-based CSP is the follow-up, and it needs a
 * per-request header mechanism that does not exist in this app yet.
 *
 * Given that, the full policy ships REPORT-ONLY by default (see `resolveCspMode`)
 * so an operator can see what it would break before switching it on.
 *
 * `style-src 'unsafe-inline'`: TinyMCE injects inline styles into the editor
 * body, and the content it produces carries `style` attributes that the public
 * post renderer emits. Removing it breaks the editor and every existing post.
 *
 * `img-src https:`: images are served as presigned URLs pointing at whichever
 * S3-compatible endpoint the operator configured. That endpoint is runtime
 * config — it can be changed in Admin > Settings without a rebuild — so it
 * cannot be enumerated in a build-time header.
 *
 * `connect-src` includes `https:` for the same reason: the browser fetches
 * images and media straight from the configured bucket.
 */
export const CSP_DIRECTIVES: Record<string, string> = {
  "default-src": "'self'",
  "script-src": "'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src": "'self' 'unsafe-inline'",
  "img-src": "'self' data: blob: https:",
  "font-src": "'self' data:",
  "media-src": "'self' blob: https:",
  "connect-src": "'self' https:",
  // The editor renders its body in a same-origin iframe, and TinyMCE creates
  // blob: workers; neither is a framing risk, both break without this.
  "frame-src": "'self' blob:",
  "worker-src": "'self' blob:",
  // Nothing in this app embeds a plugin, and object/embed is a classic
  // sandbox-escape vector for uploaded content.
  "object-src": "'none'",
  // Stops injected markup repointing every relative URL on the page.
  "base-uri": "'self'",
  // Stops an injected form posting credentials off-site.
  "form-action": "'self'",
  // Clickjacking. Enforced separately as well — see buildSecurityHeaders.
  "frame-ancestors": "'none'",
}

export function buildContentSecurityPolicy(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, value]) => `${directive} ${value}`)
    .join("; ")
}

/**
 * Reads the operator's choice from the environment.
 *
 * Default is `report-only`, deliberately. Shipping an enforcing CSP by default
 * in software people install on their own sites means the first experience of
 * a misconfiguration is a blank page, and the second is an issue report. An
 * operator who wants enforcement sets `FLOWCMS_CSP=enforce`; one who manages
 * CSP at their reverse proxy sets `FLOWCMS_CSP=off`.
 */
export function resolveCspMode(value: string | undefined): CspMode {
  if (value === "enforce" || value === "off") return value
  return "report-only"
}

export interface SecurityHeaderOptions {
  isProduction: boolean
  mode: CspMode
}

export interface HeaderEntry {
  key: string
  value: string
}

export function buildSecurityHeaders({
  isProduction,
  mode,
}: SecurityHeaderOptions): HeaderEntry[] {
  const headers: HeaderEntry[] = [
    // Uploaded files are served back to browsers. Sniffing an uploaded blob
    // into text/html is how a file store becomes an XSS vector.
    { key: "X-Content-Type-Options", value: "nosniff" },

    // Superseded by frame-ancestors, kept for browsers that never implemented
    // it. Also the reason clickjacking stays covered when CSP is "off".
    { key: "X-Frame-Options", value: "DENY" },

    // Admin URLs contain record ids. Send the origin, never the path, to other
    // sites — while keeping full referrers for same-origin navigation, which
    // analytics and the app's own back-links rely on.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

    // This app asks for none of these. Denying them up front means an injected
    // script or an embedded third party cannot either.
    {
      key: "Permissions-Policy",
      value: [
        "accelerometer=()",
        "autoplay=()",
        "camera=()",
        "display-capture=()",
        "encrypted-media=()",
        "geolocation=()",
        "gyroscope=()",
        "magnetometer=()",
        "microphone=()",
        "midi=()",
        "payment=()",
        "usb=()",
      ].join(", "),
    },
  ]

  if (isProduction) {
    // Production only. A development machine on plain http that pins itself to
    // https is a self-inflicted outage, and browsers ignore the header over
    // http anyway — so gating it costs nothing and removes the footgun.
    //
    // No `preload`: submitting to the HSTS preload list is a decision with a
    // slow, manual reversal, and it is the operator's to make for their own
    // domain, not this software's to make for them.
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    })
  }

  const policy = buildContentSecurityPolicy()

  if (mode === "enforce") {
    headers.push({ key: "Content-Security-Policy", value: policy })
  } else if (mode === "report-only") {
    headers.push({ key: "Content-Security-Policy-Report-Only", value: policy })
    // Enforced even while the rest is only reported: `frame-ancestors` cannot
    // break a page that nobody was framing, so there is no reason to hold it
    // back behind an opt-in.
    headers.push({ key: "Content-Security-Policy", value: "frame-ancestors 'none'" })
  }

  return headers
}
