import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createCanvas } from "@napi-rs/canvas"
import {
  CAPTCHA_COOKIE_NAME,
  CAPTCHA_TTL_SECONDS,
  generateCaptchaCode,
  signCaptcha,
} from "@/Framework/Captcha/captcha"
import { getCaptchaConfig, logCaptchaConfigProblem } from "@/Framework/Captcha/captchaConfig"
import { captchaFontSpec } from "@/Framework/Captcha/captchaFont"

const WIDTH = 140
const HEIGHT = 44
const FONT_SIZE = 26

export async function GET() {
  /**
   * A deployment problem is answered as a deployment problem.
   *
   * This route used to reach `signCaptcha()` with no secret configured, which
   * threw `CAPTCHA_SECRET is not set` out of the handler and produced an opaque
   * 500 on the login page. The CAPTCHA was not weakened by that — nobody could
   * obtain a challenge, so nobody could sign in — but an operator staring at a
   * 500 has nothing to act on, and the *real* cost was that first-run setup had
   * already completed into an installation they could never administer.
   *
   * 503 rather than 500, because the deployment is not configured to serve this
   * yet and will be after a restart with the variable set. Never 200 with an
   * unanswerable image: a challenge nobody can pass is worse than a refusal
   * that says so.
   *
   * The RESPONSE says only that the server is misconfigured. The rule that was
   * broken goes to the server log, redacted, because this endpoint is public
   * and which rule failed is a fact about the deployment that only its operator
   * needs.
   */
  const config = getCaptchaConfig()
  if (!config.ok) {
    logCaptchaConfigProblem("GET /api/captcha refused", config)
    return NextResponse.json(
      { message: "The server is not correctly configured. Contact the site administrator." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }

  const code = generateCaptchaCode()

  const canvas = createCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext("2d")

  ctx.fillStyle = "#f4f4f5"
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = `rgba(100,100,100,${0.2 + Math.random() * 0.3})`
    ctx.beginPath()
    ctx.moveTo(Math.random() * WIDTH, Math.random() * HEIGHT)
    ctx.lineTo(Math.random() * WIDTH, Math.random() * HEIGHT)
    ctx.stroke()
  }

  // The bundled font, NOT a generic family. `sans-serif` asks the host to
  // resolve a font, and the runtime image has none — which drew the code with
  // zero pixels while the background and noise lines rendered normally, so the
  // login page showed an empty captcha box that nobody could answer. See
  // `Framework/Captcha/captchaFont.ts`.
  ctx.font = captchaFontSpec(FONT_SIZE)
  ctx.textBaseline = "middle"

  const charWidth = WIDTH / (code.length + 1)
  for (let i = 0; i < code.length; i++) {
    const angle = (Math.random() - 0.5) * 0.4
    const x = charWidth * (i + 0.7)
    const y = HEIGHT / 2 + (Math.random() - 0.5) * 6
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.fillStyle = `hsl(${Math.random() * 360}, 45%, 35%)`
    ctx.fillText(code[i], 0, 0)
    ctx.restore()
  }

  const buffer = await canvas.encode("png")

  const cookieStore = await cookies()
  // The cookie carries the challenge; it is NOT what enforces expiry or single
  // use. Both of those are signed into the token and checked server-side, so a
  // client that ignores Set-Cookie (which is exactly what a scripted attack
  // does) gains nothing. maxAge just keeps a browser tidy.
  cookieStore.set(CAPTCHA_COOKIE_NAME, signCaptcha(code), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CAPTCHA_TTL_SECONDS,
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  })
}
