import { describe, expect, it } from "vitest"
import {
  MAX_REDIRECTS,
  assertPublicUrl,
  isBlockedIpAddress,
  parsePublicUrl,
} from "@/Framework/Net/ssrfGuard"

describe("parsePublicUrl — scheme allowlist", () => {
  it("accepts http and https", () => {
    expect(parsePublicUrl("http://example.com/a").ok).toBe(true)
    expect(parsePublicUrl("https://example.com/a").ok).toBe(true)
  })

  it("rejects every other scheme", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "gopher://example.com/x",
      "data:text/html,<script>alert(1)</script>",
      "javascript:alert(1)",
      "blob:https://example.com/uuid",
      "ws://example.com",
    ]) {
      expect(parsePublicUrl(url).ok, url).toBe(false)
    }
  })

  it("rejects unparseable input rather than throwing", () => {
    expect(parsePublicUrl("").ok).toBe(false)
    expect(parsePublicUrl("not a url").ok).toBe(false)
    expect(parsePublicUrl("http://").ok).toBe(false)
  })

  it("rejects a URL carrying embedded credentials", () => {
    // Credentials in a URL are a classic way to confuse a downstream parser
    // about which host is really being contacted.
    expect(parsePublicUrl("http://user:pass@example.com/").ok).toBe(false)
  })
})

describe("isBlockedIpAddress — IPv4", () => {
  it("blocks loopback", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "127.255.255.254"]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true)
    }
  })

  it("blocks every RFC1918 private range", () => {
    for (const ip of [
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.20.10.5",
      "172.31.255.255",
      "192.168.0.1",
      "192.168.1.254",
    ]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true)
    }
  })

  it("blocks link-local, including the cloud metadata address", () => {
    // 169.254.169.254 is the single most valuable SSRF target in existence:
    // on AWS, GCP and Azure it hands out instance credentials.
    expect(isBlockedIpAddress("169.254.169.254")).toBe(true)
    expect(isBlockedIpAddress("169.254.0.1")).toBe(true)
  })

  it("blocks the other reserved ranges an attacker can reach", () => {
    for (const ip of [
      "0.0.0.0",
      "0.1.2.3",
      "100.64.0.1",
      "192.0.0.1",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true)
    }
  })

  it("does not block ordinary public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "11.0.0.1"]) {
      expect(isBlockedIpAddress(ip), ip).toBe(false)
    }
  })

  it("blocks 172.16/12 without over-blocking its neighbours", () => {
    // The classic off-by-one: 172.16.0.0/12 is 172.16.x.x through 172.31.x.x.
    expect(isBlockedIpAddress("172.15.255.255")).toBe(false)
    expect(isBlockedIpAddress("172.16.0.0")).toBe(true)
    expect(isBlockedIpAddress("172.31.255.255")).toBe(true)
    expect(isBlockedIpAddress("172.32.0.0")).toBe(false)
  })
})

describe("isBlockedIpAddress — IPv6", () => {
  it("blocks loopback and unspecified", () => {
    expect(isBlockedIpAddress("::1")).toBe(true)
    expect(isBlockedIpAddress("::")).toBe(true)
  })

  it("blocks unique-local and link-local", () => {
    for (const ip of ["fc00::1", "fd12:3456:789a::1", "fe80::1", "febf::1"]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true)
    }
  })

  it("blocks IPv4-mapped addresses that decode to a private v4 address", () => {
    // ::ffff:127.0.0.1 is loopback wearing a v6 hat. A guard that only checks
    // the textual form misses it entirely.
    expect(isBlockedIpAddress("::ffff:127.0.0.1")).toBe(true)
    // The same addresses after WHATWG URL normalisation rewrites the embedded
    // v4 part into hex groups — which is the only form the guard actually
    // receives once a URL has been parsed.
    expect(isBlockedIpAddress("::ffff:7f00:1")).toBe(true)
    expect(isBlockedIpAddress("::ffff:a9fe:a9fe")).toBe(true)
    expect(isBlockedIpAddress("::ffff:169.254.169.254")).toBe(true)
    expect(isBlockedIpAddress("::ffff:10.0.0.1")).toBe(true)
  })

  it("does not block a public IPv6 address", () => {
    expect(isBlockedIpAddress("2606:4700:4700::1111")).toBe(false)
  })
})

describe("assertPublicUrl — literal hosts need no DNS", () => {
  it("rejects a URL whose host is a private literal address", async () => {
    for (const url of [
      "http://127.0.0.1:8080/admin",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/internal",
      "http://192.168.1.1/",
      "http://[::1]:3000/",
      "http://[::ffff:127.0.0.1]/",
    ]) {
      const verdict = await assertPublicUrl(url)
      expect(verdict.ok, url).toBe(false)
    }
  })

  it("rejects hostnames that resolve to nothing", async () => {
    const verdict = await assertPublicUrl(
      "https://this-host-should-not-exist-flowcms-test.invalid/"
    )
    expect(verdict.ok).toBe(false)
  })

  it("rejects localhost by name, not only by address", async () => {
    expect((await assertPublicUrl("http://localhost:3000/")).ok).toBe(false)
    expect((await assertPublicUrl("http://LOCALHOST/")).ok).toBe(false)
  })

  it("caps redirect following at a small number", () => {
    expect(MAX_REDIRECTS).toBeGreaterThan(0)
    expect(MAX_REDIRECTS).toBeLessThanOrEqual(5)
  })
})
