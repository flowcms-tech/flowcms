import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The internal admin route stays internal, enforced rather than documented.
 *
 * `/admin-panel` is where the App Router files live. It is not a URL, and the
 * moment a link, redirect, or fetch hardcodes it, the configured admin path
 * stops being configurable for that one path — a class of bug that produces a
 * dead link only for operators who changed the default, which is to say the
 * people least likely to be running the test suite.
 *
 * Modelled on tests/architecture/layering.test.ts. A convention only written
 * down gets violated by whoever needs a URL in a hurry; a test does not.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function rel(file: string): string {
  return relative(SRC, file).split(sep).join("/")
}

/**
 * Files allowed to name the internal route in code.
 *
 * Each is part of the routing implementation itself — the thing that maps the
 * configured public path onto the filesystem — rather than a consumer of it.
 */
const ALLOWED = [
  "proxy.ts",
  "Framework/Config/adminPathCore.ts",
  "Framework/Config/adminPath.ts",
  "Framework/Functions/reservedPaths.ts",
]

function isAllowed(path: string): boolean {
  // The filesystem route itself obviously lives at this path.
  return path.startsWith("app/admin-panel/") || ALLOWED.includes(path)
}

/** Strip comments so prose explaining the route is not a violation — only code
 *  is. The distinction matters: this codebase documents its reasoning heavily,
 *  and a test that punished explanation would be answered by deleting it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

const files = walk(SRC)

describe("the internal admin route is not referenced by user-facing code", () => {
  it("finds the source tree (guards against the walker matching nothing)", () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it("has no /admin-panel string in code outside the routing implementation", () => {
    const offenders: string[] = []
    for (const file of files) {
      const path = rel(file)
      if (isAllowed(path)) continue
      if (stripComments(readFileSync(file, "utf8")).includes("/admin-panel")) {
        offenders.push(path)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe("the admin path stays runtime-configurable", () => {
  it("has no NEXT_PUBLIC_ admin path variable anywhere", () => {
    // NEXT_PUBLIC_* is inlined at build time. Introducing one would make the
    // runtime override a fiction: the server would route to the new path while
    // every client-rendered link still pointed at the old one.
    const offenders = files.filter((file) =>
      readFileSync(file, "utf8").includes("NEXT_PUBLIC_FLOWCMS_ADMIN_PATH"),
    )
    expect(offenders.map(rel)).toEqual([])
  })

  it("reads FLOWCMS_ADMIN_PATH from only the sanctioned modules", () => {
    // Three readers, each for a stated reason: adminPath.ts is the server
    // entry point; proxy.ts and auth.config.ts cannot import it because it
    // pulls in `server-only`, which does not belong in the proxy bundle.
    const readers = files
      .filter((file) => readFileSync(file, "utf8").includes("process.env.FLOWCMS_ADMIN_PATH"))
      .map(rel)
      .sort()

    expect(readers).toEqual([
      "Framework/Auth/auth.config.ts",
      "Framework/Config/adminPath.ts",
      "proxy.ts",
    ])
  })
})
