import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * The File Manager has two shells — the admin page and the picker dialog — and
 * exactly one implementation behind them, `FileManagerBrowser`.
 *
 * That is the whole point of the design: a feature added to the browser reaches
 * both shells at once, because neither shell contains file-manager UI of its
 * own. The failure mode this guards is someone adding a toolbar, a dialog or a
 * button to ONE shell, which silently gives the page something the picker does
 * not have. That is precisely how the previous picker drifted into a separate,
 * upload-less reimplementation.
 *
 * A source-level check, because there is nothing to assert at runtime: the
 * property is about where code lives, not what it does.
 *
 * See dev-docs/superpowers/specs/2026-09-01-file-manager-embeddable-design.md.
 */

const root = fileURLToPath(new URL("../..", import.meta.url))

const SHELLS = [
  "src/app/admin-panel/(panel)/file-manager/page.tsx",
  "src/Modules/FileManager/FileManagerPickerModal.tsx",
] as const

/** The browser, and the frame a dialog needs to host it. Nothing else. */
const ALLOWED_MODULE_IMPORTS = [
  "FileManagerBrowser",
  "FileManagerPickerModal",
]

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, `file://${root}`), "utf8")
}

function importedPaths(source: string): string[] {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
}

describe("File Manager shell parity", () => {
  it.each(SHELLS)("%s imports no File Manager internals", (shell) => {
    const offenders = importedPaths(read(shell))
      .filter((path) => path.includes("FileManager") || path.includes("Modules/FileManager"))
      .filter((path) => !ALLOWED_MODULE_IMPORTS.some((allowed) => path.endsWith(allowed)))

    expect(
      offenders,
      `${shell} may only import ${ALLOWED_MODULE_IMPORTS.join(" or ")}. Anything else means ` +
        `file-manager UI is being added to one shell and not the other — put it in ` +
        `FileManagerBrowser instead, where both shells get it.`
    ).toEqual([])
  })

  it.each(SHELLS)("%s stays a thin shell", (shell) => {
    // Not a style rule: a shell long enough to hold real UI is a shell that has
    // started to become a second implementation.
    //
    // COMMENTS ARE NOT COUNTED. These two files carry more explanation than
    // code precisely because what they must NOT grow into is the subtle part —
    // penalising that would push the reasoning out of the files that need it.
    const code = read(shell)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !/^(\/\/|\/\*|\*)/.test(line))

    expect(code.length).toBeLessThan(45)
  })

  it("the picker dialog reaches the browser through the selection prop only", () => {
    const source = read("src/Modules/FileManager/FileManagerPickerModal.tsx")
    expect(source).toContain("<FileManagerBrowser")
    expect(source).toContain("selection={")
  })

  it("the duplicate picker implementation is gone", () => {
    // Each of these was a parallel copy of something the File Manager already
    // had: its own tree, its own icon set, its own grid, its own listing call.
    const removed = [
      "src/components/shared/ElementFileSelector/ElementFileSelectorModal.tsx",
      "src/components/shared/ElementFileSelector/ElementFileSelectorTreeNode.tsx",
      "src/components/shared/ElementFileSelector/ElementFileSelectorFileIcon.tsx",
      "src/components/shared/ElementFileSelector/ElementFileSelector.api.ts",
    ]

    for (const path of removed) {
      expect(() => read(path), `${path} is back — the duplication has returned`).toThrow()
    }
  })
})
