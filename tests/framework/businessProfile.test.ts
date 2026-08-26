import { describe, expect, it } from "vitest"
import {
  DEFAULT_BUSINESS_TYPE,
  resolveBrandFrom,
  resolveBusinessProfileFrom,
} from "@/Framework/Settings/businessProfile"

/**
 * The business profile after the customer-specific config file was deleted.
 *
 * The rule these tests enforce is narrow and important: when a setting is
 * absent, FlowCMS emits NOTHING for it. It does not fall back to a previous
 * customer's data, and it does not invent plausible-looking data either —
 * publishing a guessed address or guessed opening hours in machine-readable
 * form is worse than publishing none, because a search engine will believe it.
 */

/** A settings row with nothing filled in. */
const EMPTY = {}

describe("resolveBusinessProfileFrom — nothing configured", () => {
  const profile = resolveBusinessProfileFrom(null)

  it("reports itself as unconfigured", () => {
    expect(profile.isConfigured).toBe(false)
  })

  it("has no business name", () => {
    // Critically NOT the site name. `siteName` defaults to "FlowCMS", and
    // emitting `"name": "FlowCMS"` inside a LocalBusiness node would tell
    // search engines that the CMS itself is the local business.
    expect(profile.name).toBeNull()
  })

  it("invents no contact details", () => {
    expect(profile.phone).toBeNull()
    expect(profile.email).toBeNull()
    expect(profile.legalName).toBeNull()
  })

  it("invents no address", () => {
    expect(profile.address).toBeNull()
  })

  it("invents no coordinates or price range", () => {
    expect(profile.geo).toBeNull()
    expect(profile.priceRange).toBeNull()
  })

  it("invents no opening hours", () => {
    // The old resolver defaulted to a 24/7 OpeningHoursSpecification because
    // the previous customer happened to trade 24/7. Claiming a business is
    // always open when nobody said so is fabricated data.
    expect(profile.openingHours).toEqual([])
  })

  it("invents no service areas or social profiles", () => {
    expect(profile.serviceAreaNames).toEqual([])
    expect(profile.socialProfileUrls).toEqual([])
  })

  it("uses the neutral schema.org base type", () => {
    expect(profile.businessType).toBe("LocalBusiness")
    expect(DEFAULT_BUSINESS_TYPE).toBe("LocalBusiness")
  })

  it("treats a row of empty strings the same as no row at all", () => {
    const blank = resolveBusinessProfileFrom({
      businessName: "",
      businessLegalName: "",
      businessPhone: "",
      addressCity: "",
    })
    expect(blank.isConfigured).toBe(false)
    expect(blank.name).toBeNull()
    expect(blank.address).toBeNull()
  })
})

describe("resolveBusinessProfileFrom — carries no trace of any prior customer", () => {
  const profile = resolveBusinessProfileFrom(EMPTY)
  const serialized = JSON.stringify(profile).toLowerCase()

  it("emits no locksmith or LAK-specific defaults", () => {
    for (const trace of ["locksmith", "lak", "vaughan", "toronto", "ontario", "canada"]) {
      expect(serialized, `default profile leaked "${trace}"`).not.toContain(trace)
    }
  })

  it("emits no phone number of any shape", () => {
    expect(JSON.stringify(profile)).not.toMatch(/\+?\d[\d\s()-]{6,}/)
  })
})

describe("resolveBusinessProfileFrom — configured", () => {
  it("uses the configured business name and marks itself configured", () => {
    const profile = resolveBusinessProfileFrom({ businessName: "Blue Harbour Bakery" })
    expect(profile.name).toBe("Blue Harbour Bakery")
    expect(profile.isConfigured).toBe(true)
  })

  it("lets the operator override the schema.org type", () => {
    expect(resolveBusinessProfileFrom({ businessType: "Bakery" }).businessType).toBe("Bakery")
  })

  it("builds an address from whatever subset is filled in", () => {
    const profile = resolveBusinessProfileFrom({ addressCity: "Lisbon", addressCountry: "PT" })
    expect(profile.address).toEqual({
      street: null,
      city: "Lisbon",
      region: null,
      postalCode: null,
      country: "PT",
    })
  })

  it("requires both coordinates before emitting a geo node", () => {
    // A geo node with only a latitude is invalid and fails validation rather
    // than degrading.
    expect(resolveBusinessProfileFrom({ geoLatitude: "38.7" }).geo).toBeNull()
    expect(resolveBusinessProfileFrom({ geoLongitude: "-9.1" }).geo).toBeNull()
    expect(
      resolveBusinessProfileFrom({ geoLatitude: "38.7", geoLongitude: "-9.1" }).geo
    ).toEqual({ latitude: "38.7", longitude: "-9.1" })
  })

  it("parses the JSON list columns", () => {
    const profile = resolveBusinessProfileFrom({
      serviceAreaNames: JSON.stringify(["Lisbon", "Porto"]),
      socialProfileUrls: JSON.stringify(["https://example.com/x"]),
      openingHours: JSON.stringify([
        { dayOfWeek: ["Monday"], opens: "09:00", closes: "17:00" },
      ]),
    })
    expect(profile.serviceAreaNames).toEqual(["Lisbon", "Porto"])
    expect(profile.socialProfileUrls).toEqual(["https://example.com/x"])
    expect(profile.openingHours).toHaveLength(1)
  })

  it("degrades to empty rather than throwing on malformed stored JSON", () => {
    // This runs during public-page metadata generation, where an exception is
    // a 500 on the article itself.
    const profile = resolveBusinessProfileFrom({
      serviceAreaNames: "{not json",
      openingHours: "[[[",
      socialProfileUrls: '{"not":"an array"}',
    })
    expect(profile.serviceAreaNames).toEqual([])
    expect(profile.openingHours).toEqual([])
    expect(profile.socialProfileUrls).toEqual([])
  })
})

describe("resolveBrandFrom", () => {
  it("falls back to a neutral product name and no tagline", () => {
    const brand = resolveBrandFrom(null)
    expect(brand.siteName).toBe("FlowCMS")
    // The previous default was the prior customer's marketing tagline, which
    // then appeared on every unconfigured install.
    expect(brand.tagline).toBeNull()
  })

  it("uses configured values when present", () => {
    const brand = resolveBrandFrom({ siteName: "Blue Harbour", tagline: "Bread, daily." })
    expect(brand.siteName).toBe("Blue Harbour")
    expect(brand.tagline).toBe("Bread, daily.")
  })

  it("carries no customer branding in its defaults", () => {
    const serialized = JSON.stringify(resolveBrandFrom(null)).toLowerCase()
    for (const trace of ["security. access", "locksmith", "lak"]) {
      expect(serialized).not.toContain(trace)
    }
  })
})
