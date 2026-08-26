import { describe, expect, it } from "vitest"
import { serializeJsonLd } from "@/Framework/Functions/serializeJsonLd"

describe("serializeJsonLd", () => {
  it("prevents a value from closing the script element", () => {
    // The stored-XSS payload: a page or post title that ends the JSON-LD
    // <script> block early and opens a real one.
    const out = serializeJsonLd({
      "@type": "WebPage",
      name: "</script><script>alert(document.domain)</script>",
    })

    expect(out).not.toContain("</script>")
    expect(out).not.toContain("<script")
    // Present, but only as the six-character escape sequence backslash-u003c.
    expect(out).toContain(String.fromCharCode(0x5c) + "u003c")
    // And still readable as the original data.
    expect(JSON.parse(out).name).toBe("</script><script>alert(document.domain)</script>")
  })

  it("escapes every angle bracket, not only the ones in a closing tag", () => {
    const out = serializeJsonLd({ name: "<img src=x onerror=alert(1)>" })
    expect(out).not.toContain("<")
    expect(out).not.toContain(">")
  })

  it("escapes a payload hidden in a nested value", () => {
    const out = serializeJsonLd({
      publisher: { name: "ok", logo: { url: "</script><svg onload=alert(1)>" } },
    })
    expect(out).not.toContain("</script>")
  })

  it("escapes a payload hidden in a key", () => {
    const out = serializeJsonLd({ "</script><b>": "value" })
    expect(out).not.toContain("</script>")
  })

  it("escapes the line separators that break inline script parsing", () => {
    const out = serializeJsonLd({ name: "a\u2028b\u2029c" })
    expect(out).not.toContain("\u2028")
    expect(out).not.toContain("\u2029")
  })

  it("round-trips to the same data, so escaping never changes the schema", () => {
    // Escaping must be lossless: search engines have to read exactly what the
    // page meant to say.
    const data = {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Locks & Keys <em>guide</em>",
      description: "5 > 3 && 2 < 4",
      nested: { list: [1, "two", null, true] },
    }
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data)
  })

  it("escapes ampersands losslessly", () => {
    const out = serializeJsonLd({ name: "Fish & Chips" })
    expect(out).not.toContain("&")
    expect(JSON.parse(out)).toEqual({ name: "Fish & Chips" })
  })
})
