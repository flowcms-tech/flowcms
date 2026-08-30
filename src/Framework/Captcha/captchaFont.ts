import { existsSync } from "node:fs"
import path from "node:path"
import { GlobalFonts } from "@napi-rs/canvas"

/**
 * THE FONT THE LOGIN CAPTCHA IS DRAWN WITH, SHIPPED AS BYTES.
 *
 * WHY THIS MODULE EXISTS
 *
 * `/api/captcha` used to draw its code with `ctx.font = "bold 26px sans-serif"`.
 * `sans-serif` is not a font. It is a request that the host resolve one, and
 * the host in question is `node:22-bookworm-slim`, which has no fonts at all —
 * no `/usr/share/fonts`, no fontconfig, nothing. `@napi-rs/canvas` reported
 * `GlobalFonts.families.length === 0`, `measureText()` returned width 0, and
 * `fillText()` drew ZERO pixels.
 *
 * The way that failed is the reason it survived to production. The captcha's
 * background and its six noise lines are drawn with geometry rather than
 * glyphs, so they rendered perfectly: the login page showed a normal-looking
 * captcha box containing a squiggle and no code. Status 200, a real PNG, and a
 * cookie carrying a perfectly valid signed challenge — for an image nobody
 * could read. Every part of the CAPTCHA worked except the part a human has to
 * see, so nobody could sign in to the admin panel.
 *
 * Note what did NOT catch it. The secret was configured, so `captchaConfig`'s
 * verdict was `usable` and all four of its callers — startup, readiness, the
 * route's 503 guard, first-run prerequisites — correctly said the deployment
 * was fine. They check whether the challenge can be *signed*, which it could.
 * Whether it can be *seen* is a different question, and no amount of secret
 * validation asks it.
 *
 * THE FIX IS TO STOP ASKING THE HOST
 *
 * The font travels with the application and is registered by name, so the image
 * renders identically on a fontless container, on a contributor's laptop, and
 * on whatever base image a self-hoster happens to pick. A generic family name
 * is a dependency on the environment, and this is software other people install
 * in environments we will never see.
 *
 * Geist Mono Bold, because it is already a pinned dependency of this project
 * (`geist`, SIL Open Font License 1.1), it is monospace and heavy — which is
 * what you want for five distorted characters — and at ~147 KB it is small
 * enough to commit without a second thought. The bytes are copied into the
 * repository rather than read out of `node_modules/geist` so that the render
 * path does not depend on a package layout that Next's standalone build prunes.
 * `LICENSE.txt` sits beside the file, as the OFL requires.
 */

/**
 * The family the font registers as.
 *
 * Deliberately not "Geist Mono": registering under a private name means this
 * never collides with a system-installed copy of the same family, so what gets
 * drawn is always the file below and never whatever the host happened to have.
 */
export const CAPTCHA_FONT_FAMILY = "FlowCMSCaptcha"

/**
 * Resolved from `process.cwd()` rather than from this module's own location.
 *
 * The route that uses it is compiled into `.next/server` and, in a standalone
 * build, into a bundle whose `__dirname` bears no relation to the source tree —
 * so a module-relative path would resolve to somewhere that does not exist. The
 * working directory is the repository root under `next dev` and `vitest`, and
 * `/app` in the runtime image, which is exactly where the Dockerfile copies
 * this directory. That is the same reason `src/db/migrations` is addressed this
 * way: Next's tracer cannot see a file that is only ever read at runtime, so it
 * gets an explicit COPY and an explicit path.
 */
export const CAPTCHA_FONT_PATH = path.join(
  process.cwd(),
  "src",
  "Framework",
  "Captcha",
  "fonts",
  "GeistMono-Bold.ttf",
)

/**
 * Registration is global and permanent within a process, so it is done once and
 * the outcome remembered. `null` means "not yet attempted".
 */
let registered: boolean | null = null

/**
 * Registers the bundled font, at most once per process.
 *
 * Returns whether the font is available to draw with. Safe to call on every
 * request: after the first, it is a boolean read.
 */
export function ensureCaptchaFont(): boolean {
  if (registered !== null) return registered

  try {
    if (!existsSync(CAPTCHA_FONT_PATH)) {
      console.error(
        `[flowcms:captcha] Bundled captcha font missing at ${CAPTCHA_FONT_PATH}. ` +
          "The security code may render blank. This is a packaging fault, not a " +
          "configuration one — the file is committed to the repository.",
      )
      registered = false
      return registered
    }

    // `registerFromPath` returns a `FontKey | null`, not a boolean — a truthy
    // object would sail through any `if (ok)` while telling us nothing. The
    // question worth answering is whether the family can now be resolved, so
    // ask that directly instead of trusting the return value.
    GlobalFonts.registerFromPath(CAPTCHA_FONT_PATH, CAPTCHA_FONT_FAMILY)
    registered = GlobalFonts.has(CAPTCHA_FONT_FAMILY)

    if (!registered) {
      console.error(
        "[flowcms:captcha] @napi-rs/canvas refused the bundled captcha font at " +
          `${CAPTCHA_FONT_PATH}. The security code may render blank.`,
      )
    }
  } catch (error) {
    console.error("[flowcms:captcha] Could not register the bundled captcha font:", error)
    registered = false
  }

  return registered
}

/**
 * The `ctx.font` string for the captcha, at the given pixel size.
 *
 * A stack rather than a single family. The bundled font comes first and is what
 * should always be used; `sans-serif` trails it only so that a host which *does*
 * have fonts installed still draws something legible if the bundled file is ever
 * lost to a packaging mistake. The runtime image now installs a system font too,
 * which is what makes that tail worth having rather than decorative.
 */
export function captchaFontSpec(sizePx: number): string {
  ensureCaptchaFont()
  return `bold ${sizePx}px ${CAPTCHA_FONT_FAMILY}, sans-serif`
}
