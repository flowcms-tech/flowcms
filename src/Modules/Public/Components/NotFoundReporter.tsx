"use client"

import { useEffect } from "react"

/**
 * Reports a 404 to the logging endpoint. Renders nothing.
 *
 * Core-owned and deliberately separate from the theme's NotFound surface: 404
 * logging is what drives the broken-link report in the admin panel, and a site
 * must not stop collecting it because someone installed a different theme.
 *
 * Reported from the browser rather than the server so we get
 * `document.referrer`, which is the field that tells you whether the bad link
 * is yours or someone else's. `keepalive` lets the report survive the visitor
 * immediately leaving, which on a 404 page is the common case. Every filter
 * that matters (scanner ignore-list, rate limit, table cap) is applied
 * server-side.
 */
export default function NotFoundReporter() {
  useEffect(() => {
    fetch("/api/public/404-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: window.location.pathname,
        referrer: document.referrer || null,
      }),
      keepalive: true,
    }).catch(() => {})
  }, [])

  return null
}
