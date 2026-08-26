import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { classifyAuthSecret } from "@/Framework/Auth/authSecretConfig"

/**
 * Documentation and implementation must agree about `AUTH_SECRET`.
 *
 * The Phase 7.1.2 defect was not a coding mistake — it was that the example
 * configuration invited operators to deploy with a session-signing key
 * published in this repository, and nothing anywhere said otherwise or checked.
 * A configuration bug is guarded by a configuration test.
 */

const FILES = [".env.example", "compose.yml", "docs/docker.md", "docs/setup/first-run.md"]
const read = (path: string) => readFileSync(path, "utf8")

/** Lines mentioning AUTH_SECRET — the only ones this test can judge. */
function authLines(source: string): string[] {
  return source.split("\n").filter((line) => line.includes("AUTH_SECRET"))
}

describe("the files an operator reads", () => {
  it.each(FILES)("%s mentions AUTH_SECRET at all", (file) => {
    // Guards against a rename quietly emptying every assertion below.
    expect(authLines(read(file)).length, file).toBeGreaterThan(0)
  })

  it.each(FILES)("%s never calls AUTH_SECRET optional", (file) => {
    for (const line of authLines(read(file))) {
      const applied = /AUTH_SECRET[^|\n]{0,40}\|\s*\*?\*?optional/i.test(line)
      expect(applied, `${file}: ${line}`).toBe(false)
    }
  })

  /**
   * A POSITIVE assertion, deliberately.
   *
   * The first draft of this test tried to forbid the old wording — "the
   * container refuses to start without one", stated as if presence were the
   * whole guarantee. It did not work, and the reason is worth recording: that
   * sentence lives in a comment line that never mentions `AUTH_SECRET`, so a
   * filter keyed on the variable name never sees it. Restoring the original
   * text left the test green.
   *
   * Requiring the correction to be PRESENT cannot be dodged that way. If
   * somebody reverts the block, the explanation disappears with it and this
   * fails.
   */
  it("compose.yml explains that its presence guard is not a strength check", () => {
    const compose = read("compose.yml")
    // Comment markers and line wrapping stripped, so the assertions read the
    // PROSE rather than its layout — YAML comments interrupt every phrase with
    // `\n      # `.
    const block = compose
      .slice(0, compose.indexOf("CAPTCHA_SECRET"))
      .replace(/\n\s*#\s?/g, " ")
      .replace(/\s+/g, " ")

    expect(block).toMatch(/only proves that SOMETHING is set/i)
    expect(block).toMatch(/[Ss]trength is validated by the application/)
    expect(block.toLowerCase()).toMatch(/replica/)
  })

  it("docs/docker.md distinguishes presence from strength", () => {
    const row = read("docs/docker.md")
      .split("\n")
      .find((line) => line.startsWith("| `AUTH_SECRET`"))
    expect(row, "the variable table must still list AUTH_SECRET").toBeTruthy()
    expect(row!).toMatch(/\*\*required\*\*/i)
    expect(row!).toMatch(/validates/i)
    expect(row!).toMatch(/not ready/i)
  })
})

describe(".env.example and the validator agree", () => {
  const example = read(".env.example")
  // Anchored on the section header rather than a character offset, so adding a
  // line above cannot silently move the window off the text being asserted.
  const section = () =>
    example.slice(example.indexOf("--- Auth.js"), example.indexOf("--- Login CAPTCHA"))

  it("ships a placeholder the validator REFUSES", () => {
    // The file is meant to be copied. If its own sample passed validation,
    // copying it would deploy a CMS whose signing key is in this repository.
    const sample = example.match(/^AUTH_SECRET=(.*)$/m)?.[1] ?? ""
    expect(sample.length).toBeGreaterThan(0)
    expect(classifyAuthSecret(sample).state).toBe("unsafe")
  })

  it("says the placeholder is refused, rather than leaving it a surprise", () => {
    expect(section()).toMatch(/REFUSED|refuses/i)
  })

  it("documents it as REQUIRED", () => {
    expect(section()).toMatch(/REQUIRED/)
  })

  it("documents how to generate one", () => {
    expect(section()).toMatch(/randomBytes|openssl rand/)
  })

  it("documents that rotation signs everyone out", () => {
    expect(section().toLowerCase()).toMatch(/signs every user out|signs everyone out/)
  })

  it("documents the multi-replica requirement", () => {
    expect(section().toLowerCase()).toMatch(/replica/)
  })

  it("states that FlowCMS never generates one", () => {
    expect(section().toLowerCase()).toMatch(/never generates|no runtime/)
  })
})

describe("compose ships no usable default", () => {
  const compose = read("compose.yml")

  it("keeps the presence guard", () => {
    expect(compose).toMatch(/AUTH_SECRET:\s*"\$\{AUTH_SECRET:\?/)
  })

  it("supplies no fallback value", () => {
    // `${AUTH_SECRET:-something}` would be a built-in signing key shared by
    // every deployment that forgot to set one.
    expect(compose).not.toMatch(/AUTH_SECRET:\s*.?\$\{AUTH_SECRET:-[^}\s]/)
  })

  it("contains no value that would pass validation", () => {
    for (const line of compose.split("\n")) {
      // Only a LITERAL value counts. `${AUTH_SECRET:?…}` is an interpolation
      // carrying an error message, not a shipped secret — and that message is
      // long and varied enough to pass an entropy check, which is exactly the
      // false positive this exclusion prevents.
      const literal = line.match(/AUTH_SECRET:\s*"?([^"\n]*?)"?\s*$/)
      if (!literal || literal[1].includes("${")) continue
      expect(classifyAuthSecret(literal[1]).ok, `compose ships a usable secret: ${line}`).toBe(false)
    }
  })
})

describe("no committed file contains a secret that would pass validation", () => {
  it.each([".env.example", "compose.yml", "docs/docker.md"])("%s", (file) => {
    for (const line of read(file).split("\n")) {
      const match = line.match(
        /^\s*#?\s*(AUTH_SECRET|CAPTCHA_SECRET|PREVIEW_SECRET|FLOWCMS_SETUP_TOKEN)[=:]\s*"?([^"$\s][^"\n]*?)"?\s*$/,
      )
      if (!match) continue
      expect(
        classifyAuthSecret(match[2]).ok,
        `${file} appears to contain a real ${match[1]}: ${line.trim()}`,
      ).toBe(false)
    }
  })
})

describe("the installer handoff names AUTH_SECRET", () => {
  const doc = read("docs/setup/first-run.md")
  // The heading used to read "What the future installer must generate".
  // create-flowcms is no longer future — it exists in packages/create-flowcms —
  // so the heading lost the word, and this anchor must not depend on it.
  //
  // indexOf returning -1 would make slice(-1) yield the LAST CHARACTER, whose
  // length is 1, so a length check alone would pass on a missing heading.
  // Assert the index instead.
  const start = doc.indexOf("What the installer generates")
  const section = doc.slice(start)

  it("exists and lists AUTH_SECRET", () => {
    expect(start, "docs/setup/first-run.md has no installer-generates section").toBeGreaterThan(-1)
    expect(section).toContain("AUTH_SECRET")
  })

  it("requires a cryptographically secure source and forbids a default", () => {
    expect(section).toMatch(/cryptographically secure/i)
    expect(section).toMatch(/never ship a default/i)
  })

  it("states that the same value must reach every replica", () => {
    expect(section.toLowerCase()).toMatch(/every replica/)
  })
})

describe("the rotation contract is documented where an operator will find it", () => {
  const doc = read("docs/setup/first-run.md")

  it("says rotation signs everyone out", () => {
    expect(doc.toLowerCase()).toMatch(/rotating it signs everyone out/)
  })

  it("says there is no keyring or previous-secret support", () => {
    // Recorded so nobody adds one later thinking it was an oversight.
    // Whitespace-tolerant: prose wraps, and a guard that a line break defeats
    // is a guard that fails for the wrong reason.
    expect(doc.toLowerCase().replace(/\s+/g, " ")).toMatch(/no keyring/)
    expect(doc.toLowerCase()).toMatch(/previous-secret/)
  })

  it("tells an upgrading operator exactly what to do", () => {
    expect(doc).toMatch(/Replace `AUTH_SECRET` and restart/)
  })
})
