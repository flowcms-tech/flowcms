import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { classifyCaptchaConfig } from "@/Framework/Captcha/captchaConfig"

/**
 * The documentation and the implementation must agree about `CAPTCHA_SECRET`.
 *
 * THIS IS THE ACTUAL PHASE 7.1.1 DEFECT, and it is worth being precise about
 * what was broken. The code was already right: an unset secret made
 * `signCaptcha()` throw and `verifyCaptchaToken()` refuse everything, so login
 * became IMPOSSIBLE — never unguarded. What was wrong was that `compose.yml`
 * and `docs/docker.md` told operators "absent disables the login CAPTCHA",
 * which is not a thing FlowCMS can do. An operator who believed them could
 * finish first-run setup — which closes permanently — and then discover they
 * could never sign in.
 *
 * A prose bug caused it, so a prose test guards it. This walks the files an
 * operator actually reads and fails if the claim comes back.
 */

const FILES = [
  ".env.example",
  "compose.yml",
  "docs/docker.md",
  "docs/setup/first-run.md",
  "README.md",
]

const read = (path: string) => readFileSync(path, "utf8")

/** Lines mentioning CAPTCHA_SECRET, which are the only ones this can judge. */
function captchaLines(source: string): string[] {
  return source.split("\n").filter((line) => line.includes("CAPTCHA_SECRET"))
}

describe("the files an operator reads", () => {
  it.each(FILES)("%s mentions CAPTCHA_SECRET at all", (file) => {
    // Guards against a rename or a deletion quietly emptying every assertion
    // below.
    expect(captchaLines(read(file)).length, file).toBeGreaterThan(0)
  })

  it.each(FILES)("%s never says a missing secret disables the CAPTCHA", (file) => {
    // The exact false claim, as a proximity check rather than an exact string
    // so a reworded version of the same lie is still caught.
    //
    // Sentences that DENY the claim are the correction itself and must survive:
    // "it does not disable the CAPTCHA", "rather than disabling the challenge".
    // So each sentence is judged separately and denials are excluded — a guard
    // that its own fix trips is a guard people delete.
    const DENIAL = /\b(not|never|no such|rather than|instead of)\b/
    const CLAIM = /(absent|missing|unset|without|no)\b[^.]{0,60}\bdisabl/

    for (const line of captchaLines(read(file))) {
      for (const sentence of line.toLowerCase().split(/(?<=\.)\s+|\|/)) {
        if (!/disabl/.test(sentence)) continue
        if (DENIAL.test(sentence)) continue
        expect(CLAIM.test(sentence), `${file}: ${sentence.trim()}`).toBe(false)
        expect(/disabl[^.]{0,40}captcha/.test(sentence), `${file}: ${sentence.trim()}`).toBe(false)
      }
    }
  })

  it.each(FILES)("%s never calls CAPTCHA_SECRET optional", (file) => {
    for (const line of captchaLines(read(file))) {
      // "optional" may appear on a line that also names PREVIEW_SECRET, which
      // genuinely is optional — so the word is only forbidden when it is the
      // classification being applied to CAPTCHA_SECRET itself.
      const applied = /CAPTCHA_SECRET[^|\n]{0,40}\|\s*\*?\*?optional/i.test(line)
      expect(applied, `${file}: ${line}`).toBe(false)
    }
  })
})

describe(".env.example and the validator agree", () => {
  const example = read(".env.example")

  it("documents CAPTCHA_SECRET as required", () => {
    const section = example.slice(example.indexOf("--- Login CAPTCHA"))
    expect(section.slice(0, 1400)).toMatch(/REQUIRED/i)
  })

  it("says plainly that there is no disabled state", () => {
    const section = example.slice(example.indexOf("--- Login CAPTCHA"))
    expect(section.slice(0, 1400).toLowerCase()).toContain("no \"captcha disabled\" state")
  })

  it("tells the operator how to generate one", () => {
    const section = example.slice(example.indexOf("--- Login CAPTCHA"))
    expect(section.slice(0, 1400)).toMatch(/randomBytes|openssl rand/)
  })

  it("ships a placeholder that the validator REFUSES", () => {
    // The file is meant to be copied. If its own sample value passed
    // validation, copying it would produce a deployment whose CAPTCHA key is
    // published in this repository.
    const sample = example.match(/^CAPTCHA_SECRET=(.*)$/m)?.[1] ?? ""
    expect(sample.length).toBeGreaterThan(0)
    expect(classifyCaptchaConfig(sample).state).toBe("unsafe")
  })

  it("contains no value that would actually pass validation", () => {
    // Belt and braces against someone pasting a real secret in while editing.
    for (const line of example.split("\n")) {
      const match = line.match(/^(AUTH_SECRET|CAPTCHA_SECRET|PREVIEW_SECRET|FLOWCMS_SETUP_TOKEN)=(.+)$/)
      if (!match) continue
      expect(classifyCaptchaConfig(match[2]).state, `${match[1]} looks like a real secret`).not.toBe(
        "usable",
      )
    }
  })
})

describe("compose does not invent a default", () => {
  const compose = read("compose.yml")

  it("passes CAPTCHA_SECRET through with an empty fallback, never a value", () => {
    // `${CAPTCHA_SECRET:-}` is correct: empty, so the app reports it as
    // missing. `${CAPTCHA_SECRET:-something}` would be a built-in insecure
    // default, which is the one thing worse than no value at all.
    expect(compose).toMatch(/CAPTCHA_SECRET:\s*\$\{CAPTCHA_SECRET:-\}/)
    // Anything between `:-` and `}` would be a built-in default.
    expect(compose).not.toMatch(/CAPTCHA_SECRET:\s*\$\{CAPTCHA_SECRET:-[^}\s]/)
  })

  it("does not hard-fail the container the way AUTH_SECRET does", () => {
    // Deliberate: an existing installation must still boot and serve its public
    // site after upgrading. The signal is /api/ready, not a refusal to start.
    expect(compose).not.toMatch(/CAPTCHA_SECRET:\s*"?\$\{CAPTCHA_SECRET:\?/)
  })
})

describe("the installer's responsibility is written down", () => {
  it("names CAPTCHA_SECRET as something create-flowcms must generate randomly", () => {
    const doc = read("docs/setup/first-run.md")
    // Anchored on "What the installer generates". The heading used to say
    // "future installer"; create-flowcms exists now, so the word went.
    // indexOf must be checked directly: slice(-1) is the last character, not
    // the empty string, so a length assertion would pass on a missing heading.
    const start = doc.indexOf("What the installer generates")
    const section = doc.slice(start)
    expect(start, "docs/setup/first-run.md has no installer-generates section").toBeGreaterThan(-1)
    expect(section).toContain("CAPTCHA_SECRET")
    expect(section).toMatch(/cryptographically secure/i)
    expect(section).toMatch(/never ship a default/i)
  })
})
