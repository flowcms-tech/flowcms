import { serializeJsonLd } from "./serializeJsonLd"

/**
 * Renders a JSON-LD graph into a script tag.
 *
 * The escaping lives in `serializeJsonLd` rather than here so that every
 * JSON-LD block in the app -- blog, custom pages, LocalBusiness -- goes through
 * one implementation. Three call sites with two behaviours is how the custom
 * page renderer ended up injectable.
 */
export default function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  )
}
