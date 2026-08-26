import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * FlowCMS is English and LTR, and this test is what keeps it that way.
 *
 * This codebase was repurposed from a Persian, right-to-left payment panel. The
 * obvious residue — the Customers module, the Iranian banking helpers, the
 * Vazirmatn font — was removed early. What survived much longer was the residue
 * that *worked*: a complete Jalali calendar inside `ElementDatePicker`, Persian
 * default tooltip titles in the shared component library, a `locale: 'fa' | 'en'`
 * prop defaulting to `'fa'` on two components that thirty-three call sites then
 * had to opt out of one by one, and a `jalaali-js` dependency that shipped into
 * every generated site.
 *
 * None of that was a bug in the sense that anything failed. It was a product
 * carrying a second product around, and it was invisible to a green suite
 * precisely because it worked. The checks below are cheap, they run on source
 * text rather than behaviour, and they fail the moment any of it comes back —
 * which is the only kind of guard that survives a codebase this size.
 *
 * Scope is `src/` on purpose. `dev-docs/superpowers/` is a historical record and is
 * deliberately not cleaned.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function rel(file: string): string {
  return relative(SRC, file).split(sep).join("/")
}

/** Source files only — never read a font or an image as text. */
const SOURCE_FILES = walk(SRC).filter((f) => /\.(ts|tsx|css|mjs|js)$/.test(f))

/**
 * Arabic, Arabic Supplement, Arabic Extended-A, and both presentation-forms
 * blocks. Persian is written in Arabic script, so the range is the check.
 *
 * PRESENTATION-FORMS-B STOPS AT U+FEFE, NOT U+FEFF.
 *
 * U+FEFF is the last code point of that Unicode block but it is not an Arabic
 * character \u2014 it is the BYTE ORDER MARK. Including it made this test report
 * "Persian-language residue" for 13 files whose only offence was a UTF-8 BOM
 * left by the previous project's editor, which is a false diagnosis: it sends
 * the next reader hunting for Persian that is not there. Phase 8 final
 * verification is where that first ran and therefore where it was first seen.
 *
 * The BOM is a real defect too, and narrowing this range must not be the way it
 * disappears \u2014 so it has its own assertion below, under its own name.
 */
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFE]/

describe("no Persian-language residue in the application", () => {
  it("has no Arabic-script character anywhere in src/", () => {
    const offenders = SOURCE_FILES.filter((f) =>
      ARABIC_SCRIPT.test(readFileSync(f, "utf8")),
    ).map(rel)

    // A user-visible string, a default prop value and a code comment are all
    // equally disqualifying: the first two ship to operators, and the third is
    // unreadable to the people this repository is now published for.
    expect(offenders).toEqual([])
  })

  it("has no UTF-8 byte order mark in any source file", () => {
    // Thirteen files carried one, from the previous project's Windows editor.
    // A BOM is invisible in every diff and survives every reformat, and it is
    // not harmless: it sits BEFORE `"use client"`, so a bundler that checks for
    // a leading directive by string comparison does not find one, and JSON
    // parsers reject a BOM outright. `.gitattributes` normalises line endings
    // and says nothing about this.
    const offenders = SOURCE_FILES.filter(
      (f) => readFileSync(f, "utf8").charCodeAt(0) === 0xfeff,
    ).map(rel)

    expect(offenders).toEqual([])
  })
})

describe("no Jalali calendar residue", () => {
  it("nothing under src/ imports jalaali-js", () => {
    const offenders = SOURCE_FILES.filter((f) =>
      /\bjalaali\b/i.test(readFileSync(f, "utf8")),
    )
      .map(rel)
      // DateFunctions.ts explains in prose why the calendar was removed. That
      // sentence is the reason the dependency does not quietly come back, so it
      // is allowed to name the package it replaced.
      .filter((f) => f !== "Framework/Functions/DateFunctions.ts")

    expect(offenders).toEqual([])
  })

  it("no shared component takes a 'fa' locale", () => {
    const offenders: string[] = []
    for (const file of SOURCE_FILES) {
      const text = readFileSync(file, "utf8")
      // The exact shapes that existed: the prop type, its default, the branch
      // it drove, and the opt-out every call site had to remember.
      if (
        /'fa'\s*\|\s*'en'/.test(text) ||
        /locale\s*=\s*'fa'/.test(text) ||
        /locale\s*===\s*'fa'/.test(text) ||
        /locale=["']fa["']/.test(text)
      ) {
        offenders.push(rel(file))
      }
    }
    expect(offenders).toEqual([])
  })
})

describe("no payment-panel residue", () => {
  it("ElementTableButton exposes no payment actions", () => {
    const source = readFileSync(
      join(SRC, "components/shared/ElementTable/TableActionsButton/ElementTableButton.tsx"),
      "utf8",
    )
    // `paySystem` and `payManual` were "pay from the system balance" and "pay by
    // hand" in a payment panel. Nothing in a CMS renders them, and a shared
    // component library is exactly where an unused export survives forever.
    expect(source).not.toMatch(/paySystem|payManual/)
  })

  it("the Iranian banking helpers are gone", () => {
    const offenders = SOURCE_FILES.filter((f) =>
      /detectCardBank|isValidIranianCard|ElementInputCardNumber|BankLogo/.test(
        readFileSync(f, "utf8"),
      ),
    ).map(rel)
    expect(offenders).toEqual([])
  })
})
