import { describe, expect, it } from "vitest"
import { buildLocalBusinessSchema } from "@/Modules/Public/Values/buildLocalBusinessJsonLd"
import { resolveBusinessProfileFrom } from "@/Framework/Settings/businessProfile"

const SITE = "https://example.com"

describe("buildLocalBusinessSchema — unconfigured", () => {
  it("emits nothing at all when no business name is set", () => {
    // Degrading safely means emitting NO node, not an empty one. A
    // LocalBusiness without a name is invalid structured data, and a search
    // engine that reads it learns something false about the site.
    expect(buildLocalBusinessSchema(resolveBusinessProfileFrom(null), SITE)).toBeNull()
  })

  it("emits nothing when only peripheral fields are filled in", () => {
    const profile = resolveBusinessProfileFrom({ businessPhone: "+15550100" })
    expect(buildLocalBusinessSchema(profile, SITE)).toBeNull()
  })
})

describe("buildLocalBusinessSchema — configured", () => {
  const full = resolveBusinessProfileFrom({
    businessName: "Blue Harbour Bakery",
    businessLegalName: "Blue Harbour Lda.",
    businessType: "Bakery",
    businessPhone: "+351210000000",
    businessEmail: "hello@example.com",
    addressStreet: "1 Dock Road",
    addressCity: "Lisbon",
    addressCountry: "PT",
    geoLatitude: "38.7",
    geoLongitude: "-9.1",
    priceRange: "$$",
    serviceAreaNames: JSON.stringify(["Lisbon", "Cascais"]),
    socialProfileUrls: JSON.stringify(["https://example.com/social"]),
    openingHours: JSON.stringify([
      { dayOfWeek: ["Monday"], opens: "07:00", closes: "15:00" },
    ]),
  })

  const schema = buildLocalBusinessSchema(full, SITE)!
  const node = schema["@graph"][0] as Record<string, unknown>

  it("produces a single-node graph with the configured type", () => {
    expect(schema["@context"]).toBe("https://schema.org")
    expect(schema["@graph"]).toHaveLength(1)
    expect(node["@type"]).toBe("Bakery")
  })

  it("scopes @id to the origin so every page describes one entity", () => {
    expect(node["@id"]).toBe("https://example.com/#business")
  })

  it("carries the configured identity and contact details", () => {
    expect(node.name).toBe("Blue Harbour Bakery")
    expect(node.legalName).toBe("Blue Harbour Lda.")
    expect(node.telephone).toBe("+351210000000")
    expect(node.email).toBe("hello@example.com")
  })

  it("emits only the address parts that were provided", () => {
    expect(node.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "1 Dock Road",
      addressLocality: "Lisbon",
      addressCountry: "PT",
    })
  })

  it("emits areaServed without inventing a containing region", () => {
    // The old version wrapped every area in `containedInPlace: "Ontario,
    // Canada"` — the previous customer's province, asserted for any operator.
    expect(node.areaServed).toEqual([
      { "@type": "Place", name: "Lisbon" },
      { "@type": "Place", name: "Cascais" },
    ])
  })

  it("emits opening hours as given", () => {
    expect(node.openingHoursSpecification).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday"],
        opens: "07:00",
        closes: "15:00",
      },
    ])
  })
})

describe("buildLocalBusinessSchema — omits rather than nulls", () => {
  const minimal = buildLocalBusinessSchema(
    resolveBusinessProfileFrom({ businessName: "Solo Trader" }),
    SITE
  )!
  const node = minimal["@graph"][0] as Record<string, unknown>

  it("includes only the name and type when nothing else is set", () => {
    expect(node.name).toBe("Solo Trader")
    expect(node["@type"]).toBe("LocalBusiness")
  })

  it("has no key whose value is null, undefined, or empty", () => {
    // `"telephone": null` is not the same as omitting telephone — validators
    // flag it, and it reads as a positive claim that there is no phone.
    for (const [key, value] of Object.entries(node)) {
      expect(value, `${key} should have been omitted`).not.toBeNull()
      expect(value, `${key} should have been omitted`).not.toBeUndefined()
      if (Array.isArray(value)) {
        expect(value.length, `empty array ${key} should have been omitted`).toBeGreaterThan(0)
      }
    }
  })

  it("emits no offer catalog", () => {
    // The old version published a hardcoded catalogue of locksmith services on
    // every page. FlowCMS has no services model, so it publishes no offers.
    expect(node.hasOfferCatalog).toBeUndefined()
  })

  it("emits no description, rather than a description about another business", () => {
    expect(node.description).toBeUndefined()
  })

  it("never asserts a rating it cannot substantiate", () => {
    expect(node.aggregateRating).toBeUndefined()
    expect(node.review).toBeUndefined()
  })
})

describe("buildLocalBusinessSchema — carries no trace of any prior customer", () => {
  it("contains no locksmith or regional strings for a configured business", () => {
    const schema = buildLocalBusinessSchema(
      resolveBusinessProfileFrom({ businessName: "Solo Trader" }),
      SITE
    )
    const serialized = JSON.stringify(schema).toLowerCase()
    for (const trace of ["locksmith", "lak", "ontario", "toronto", "canada", "greater toronto"]) {
      expect(serialized, `leaked "${trace}"`).not.toContain(trace)
    }
  })
})

describe("buildLocalBusinessSchema — malformed URL", () => {
  it("omits @id rather than throwing", () => {
    // A missing @id is a weaker graph; an exception is a blank page.
    const schema = buildLocalBusinessSchema(
      resolveBusinessProfileFrom({ businessName: "Solo Trader" }),
      "not a url"
    )!
    expect((schema["@graph"][0] as Record<string, unknown>)["@id"]).toBeUndefined()
  })

  it("works with no URL supplied at all", () => {
    const schema = buildLocalBusinessSchema(
      resolveBusinessProfileFrom({ businessName: "Solo Trader" }),
      undefined
    )
    expect(schema).not.toBeNull()
  })
})
