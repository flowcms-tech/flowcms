import type { NextConfig } from "next";
import {
  buildSecurityHeaders,
  resolveCspMode,
} from "./src/Framework/Security/securityHeaders";

const nextConfig: NextConfig = {
  // Extra origins the dev server accepts, for testing on a phone or another
  // machine on the LAN. Comma-separated, e.g. FLOWCMS_DEV_ORIGINS=192.168.0.21
  //
  // Env-driven rather than hardcoded: this previously carried one developer's
  // LAN address, which is personal machine configuration and meaningless — or
  // actively confusing — to anyone else who clones the repository.
  allowedDevOrigins: (process.env.FLOWCMS_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  /**
   * Emits `.next/standalone` — a self-contained `server.js` plus a pruned
   * `node_modules` — which is what the Docker runner stage ships.
   *
   * Standalone deliberately does NOT include `public/` or `.next/static`; Next
   * assumes a CDN fronts them. FlowCMS serves them itself (its own images, the
   * self-hosted TinyMCE bundle), so the Dockerfile copies both explicitly.
   */
  output: "standalone",
  serverExternalPackages: ["@napi-rs/canvas", "@libsql/client", "libsql"],
  images: {
    // Next 16 only serves qualities listed here, so a theme requesting an
    // unlisted quality silently gets the default. 75 is Next's own default;
    // 90 is available for large hero imagery.
    qualities: [75, 90],
  },
  async headers() {
    return [
      {
        /**
         * Baseline security headers on every response.
         *
         * The policy itself, and the reasoning for each header, lives in
         * src/Framework/Security/securityHeaders.ts — it is unit-tested there,
         * because a header set nobody can assert against drifts silently and
         * fails either open (no protection) or catastrophically (blank page).
         *
         * The full Content-Security-Policy ships REPORT-ONLY by default:
         * shipping an enforcing CSP in software other people install means the
         * first symptom of any mismatch is a blank site. Set FLOWCMS_CSP=enforce
         * to turn it on, or FLOWCMS_CSP=off if CSP is managed at a reverse
         * proxy. Clickjacking protection is enforced in every mode.
         */
        source: "/:path*",
        headers: buildSecurityHeaders({
          isProduction: process.env.NODE_ENV === "production",
          mode: resolveCspMode(process.env.FLOWCMS_CSP),
        }),
      },
      {
        /**
         * Shareable draft previews (`/blog/<slug>?preview=<token>`) must never
         * be indexable or cached. That is the entire risk of the feature: a
         * leaked link is a draft someone can read, which is survivable, but a
         * leaked link Google has crawled is a draft in the search index, which
         * is not.
         *
         * Enforced here rather than in the page, because a server component
         * cannot set response headers, and a `<meta name="robots">` tag only
         * helps a crawler that renders HTML — a shared CDN or proxy obeys
         * Cache-Control and nothing else. `has` matches on the query string, so
         * the ordinary published URL is untouched.
         *
         * NOT done in src/proxy.ts: its matcher is /admin-panel/:path* and its
         * `authorized` callback refuses anonymous requests, so widening it to
         * cover /blog would put the public blog behind the login screen.
         */
        source: "/blog/:slug",
        has: [{ type: "query", key: "preview" }],
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
        ],
      },
    ]
  },
  async redirects() {
    return [
      {
        // The sitemap is now chunked, so src/app/sitemap.ts resolves to
        // /sitemap/<id>.xml and the index it belongs to had to move — Next
        // refuses to build a route handler at /sitemap.xml while a metadata
        // sitemap also claims that path. This keeps the conventional URL
        // alive: it is already submitted to Search Console and linked from
        // elsewhere, and 404ing it would silently detach the blog from
        // indexing.
        source: "/sitemap.xml",
        destination: "/sitemap-index.xml",
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
