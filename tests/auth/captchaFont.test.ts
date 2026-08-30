import { existsSync, readFileSync } from "node:fs"
import { createCanvas } from "@napi-rs/canvas"
import { describe, expect, it } from "vitest"
import {
  CAPTCHA_FONT_FAMILY,
  CAPTCHA_FONT_PATH,
  captchaFontSpec,
  ensureCaptchaFont,
} from "@/Framework/Captcha/captchaFont"

/**
 * THE CAPTCHA MUST CARRY ITS OWN FONT.
 *
 * `/api/captcha` drew its code with `ctx.font = "bold 26px sans-serif"`, and
 * `sans-serif` is not a font — it is a request that the host resolve one.
 * `node:22-bookworm-slim` has no fonts at all (no `/usr/share/fonts`, no
 * fontconfig), so `@napi-rs/canvas` matched nothing, `measureText()` returned
 * width 0, and `fillText()` drew ZERO pixels.
 *
 * The failure was invisible in exactly the wrong way. The background and the
 * noise lines are drawn with geometry, not glyphs, so they rendered fine: the
 * login page showed a normal-looking captcha box with a squiggle in it and no
 * code. A 200, an image, a cookie carrying a perfectly valid signed challenge —
 * and nothing on screen that anyone could read. Nobody could sign in.
 *
 * A generic family name is therefore not something this route may depend on.
 * The bytes ship with the application and are registered by name, so the image
 * renders the same on a fontless container, a developer's laptop and whatever
 * base image a self-hoster picks.
 */

describe("the bundled captcha font", () => {
  it("ships with the application rather than being requested from the host", () => {
    expect(existsSync(CAPTCHA_FONT_PATH)).toBe(true)
  })

  it("is a real TrueType file, not a placeholder", () => {
    const bytes = readFileSync(CAPTCHA_FONT_PATH)
    // sfnt version 0x00010000 — a bare TTF, which is what registerFromPath wants.
    expect(bytes.subarray(0, 4).toString("hex")).toBe("00010000")
    expect(bytes.byteLength).toBeGreaterThan(10_000)
  })

  it("registers under its own family name", () => {
    expect(ensureCaptchaFont()).toBe(true)
    expect(CAPTCHA_FONT_FAMILY).not.toMatch(/^(sans-serif|serif|monospace)$/)
  })

  it("is the first family the font spec asks for", () => {
    const spec = captchaFontSpec(26)
    // The bug in one assertion. A generic family may trail the stack as a
    // fallback for a host that does have fonts, but it may never be what is
    // asked for FIRST — the whole point is not to depend on the host having any.
    expect(spec).toMatch(new RegExp(`\\d+px ${CAPTCHA_FONT_FAMILY}`))
    if (spec.includes("sans-serif")) {
      expect(spec.indexOf(CAPTCHA_FONT_FAMILY)).toBeLessThan(spec.indexOf("sans-serif"))
    }
  })
})

describe("rendering a code with it", () => {
  /** Counts pixels that are not the captcha's #f4f4f5 background. */
  function drawnPixels(fontSpec: string): number {
    const canvas = createCanvas(140, 44)
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#f4f4f5"
    ctx.fillRect(0, 0, 140, 44)
    ctx.font = fontSpec
    ctx.textBaseline = "middle"
    ctx.fillStyle = "#000000"
    ctx.fillText("ABC7K", 6, 22)

    const { data } = ctx.getImageData(0, 0, 140, 44)
    let drawn = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 200 && data[i + 1] < 200 && data[i + 2] < 200) drawn++
    }
    return drawn
  }

  it("measures a non-zero width", () => {
    ensureCaptchaFont()
    const ctx = createCanvas(140, 44).getContext("2d")
    ctx.font = captchaFontSpec(26)
    // Width 0 is precisely what a missing font reports, and it is silent.
    expect(ctx.measureText("ABC7K").width).toBeGreaterThan(0)
  })

  it("actually puts ink on the canvas", () => {
    ensureCaptchaFont()
    expect(drawnPixels(captchaFontSpec(26))).toBeGreaterThan(100)
  })

  it("draws every character the code alphabet can contain", () => {
    ensureCaptchaFont()
    const ctx = createCanvas(140, 44).getContext("2d")
    ctx.font = captchaFontSpec(26)
    for (const char of "ABCDEFGHJKLMNPQRSTUVWXYZ23456789") {
      expect(ctx.measureText(char).width, `no glyph for ${char}`).toBeGreaterThan(0)
    }
  })
})

describe("the route", () => {
  it("does not ask the host for a generic family", () => {
    const source = readFileSync("src/app/api/captcha/route.ts", "utf8")
    expect(source).not.toMatch(/px sans-serif/)
  })
})
