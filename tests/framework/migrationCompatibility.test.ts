import { mkdtempSync, rmSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  caseSensitivityBlocker,
  createCompatibilityScanner,
  probeDestinationCaseSensitivity,
  type CompatibilityIssue,
} from "@/Framework/Storage/Migration/compatibility"

/**
 * THE HARD GATE BEFORE ANY COPYING.
 *
 * S3 and a filesystem do not agree about what a name is. `a/../b`,
 * `back\slash`, `CON`, `photo.png` and `Photo.png` are five ordinary distinct
 * S3 keys; on a filesystem one is a traversal, one is a separator, one is a
 * device on Windows, and two of them may be the same file.
 *
 * Nothing here renames anything, and that is the point. Every stored reference
 * in the database names its key exactly — a post's `featuredImageKey`, an
 * `<img>` in a page body — so a migration that quietly rewrote a key would
 * produce a broken image with no error anywhere. Incompatible keys are
 * reported and the migration stops.
 */

const sensitive = () => createCompatibilityScanner({ caseSensitivity: "sensitive" })
const insensitive = () => createCompatibilityScanner({ caseSensitivity: "insensitive" })

const file = (key: string) => ({ key, kind: "file" as const })
const dir = (key: string) => ({ key, kind: "directory" as const })

function issueFor(keys: { key: string; kind: "file" | "directory" }[], caseSensitive = true) {
  const scanner = createCompatibilityScanner({ caseSensitivity: caseSensitive ? "sensitive" : "insensitive" })
  let last: CompatibilityIssue | null = null
  for (const entry of keys) last = scanner.inspect(entry) ?? last
  return last
}

describe("keys that are perfectly fine", () => {
  it.each([
    "a.png",
    "posts/a.png",
    "posts/2026/01/deep/nested/a.png",
    "posts/file with spaces.png",
    "posts/файл.png",
    "posts/日本語.png",
    "posts/emoji-🎉.png",
    "posts/dots.in.the.name.png",
    "posts/.hidden.png",
    "posts/%2e%2e.png",
    "posts/CONTENT.png",
    "posts/console.log.png",
  ])("accepts %s", (key) => {
    expect(sensitive().inspect(file(key))).toBeNull()
  })

  it("accepts a directory entry", () => {
    expect(sensitive().inspect(dir("posts/empty/"))).toBeNull()
  })
})

describe("keys the local driver itself would refuse", () => {
  it.each([
    ["parent traversal", "../secret.txt"],
    ["nested traversal", "posts/../../secret.txt"],
    ["traversal that returns inside", "posts/../posts/a.png"],
    ["dot segment", "posts/./a.png"],
    ["absolute path", "/etc/passwd"],
    ["windows drive", "C:/Windows/win.ini"],
    ["backslash", "posts\\a.png"],
    ["backslash traversal", "..\\secret.txt"],
    ["UNC path", "//server/share/x.png"],
    ["null byte", "posts/a\u0000.png"],
    ["empty segment", "posts//a.png"],
  ])("refuses %s", (_label, key) => {
    const issue = sensitive().inspect(file(key))

    expect(issue?.reason).toBe("unsafe_key")
    // Asked of the DRIVER'S OWN rule, not a copy of it — a second
    // implementation would drift, and the drift would show up as a migration
    // that passed preflight and failed mid-copy.
    expect(issue?.key).toBe(key)
  })
})

describe("Windows device names", () => {
  it.each(["CON", "con", "PRN", "aux", "NUL", "COM1", "com9", "LPT1", "lpt9"])(
    "refuses %s as a component",
    (name) => {
      expect(sensitive().inspect(file(`posts/${name}`))?.reason).toBe("reserved_name")
    },
  )

  it.each(["CON.txt", "con.png", "NUL.jpeg"])("refuses %s, extension and all", (name) => {
    // The reservation applies regardless of extension, which is the part people
    // are surprised by.
    expect(sensitive().inspect(file(name))?.reason).toBe("reserved_name")
  })

  it("refuses a reserved name used as a folder", () => {
    expect(sensitive().inspect(file("aux/inside.png"))?.reason).toBe("reserved_name")
  })

  it("allows a name that merely starts with one", () => {
    expect(sensitive().inspect(file("posts/console.png"))).toBeNull()
    expect(sensitive().inspect(file("posts/connection.png"))).toBeNull()
  })

  it("is checked even on a case-sensitive destination", () => {
    // A Linux volume today can be read from Windows tomorrow, or bind-mounted
    // from a Windows host. Checking costs one comparison.
    expect(sensitive().inspect(file("CON"))?.reason).toBe("reserved_name")
  })
})

describe("trailing dots and spaces", () => {
  it("refuses a trailing dot", () => {
    expect(sensitive().inspect(file("posts/name."))?.reason).toBe("trailing_dot")
  })

  it("refuses a trailing space", () => {
    expect(sensitive().inspect(file("posts/name .png".replace(".png", " ")))?.reason).toBe(
      "trailing_space",
    )
  })

  it("refuses a trailing dot on a folder component", () => {
    expect(sensitive().inspect(file("folder./a.png"))?.reason).toBe("trailing_dot")
  })

  it("explains why, since the reason is not obvious", () => {
    // Windows silently STRIPS them, which is what turns two distinct keys into
    // one file — a much worse outcome than a rejection.
    const issue = sensitive().inspect(file("name."))
    expect(issue?.detail).toMatch(/silently removes|same file/i)
  })

  it("allows dots and spaces anywhere else", () => {
    expect(sensitive().inspect(file("a. b.png"))).toBeNull()
    expect(sensitive().inspect(file("...leading.png"))).toBeNull()
  })
})

describe("case collisions", () => {
  it("reports two keys differing only in case on a case-INSENSITIVE destination", () => {
    const issue = issueFor([file("posts/Photo.png"), file("posts/photo.png")], false)

    expect(issue?.reason).toBe("case_collision")
    expect(issue?.collidesWith).toBe("posts/Photo.png")
  })

  it("allows the same pair on a case-SENSITIVE destination", () => {
    // On S3 and on ext4 these are two different objects, and they stay two.
    expect(issueFor([file("posts/Photo.png"), file("posts/photo.png")], true)).toBeNull()
  })

  it("names the key it collides with, so an operator can act", () => {
    const issue = issueFor([file("A/B/c.png"), file("a/b/C.png")], false)

    expect(issue?.collidesWith).toBe("A/B/c.png")
  })

  it("does not report a key colliding with itself", () => {
    const scanner = insensitive()
    expect(scanner.inspect(file("a.png"))).toBeNull()
    // The same key seen twice — an idempotent re-scan — is not a collision.
    expect(scanner.inspect(file("a.png"))).toBeNull()
  })
})

describe("file and directory collisions", () => {
  it("reports a file whose parent another key stores as a file", () => {
    // `foo` and `foo/bar.jpg` cannot both exist: one needs `foo` to be a file,
    // the other needs it to be a folder.
    const issue = issueFor([file("foo"), file("foo/bar.jpg")])

    expect(issue?.reason).toBe("file_directory_collision")
    expect(issue?.collidesWith).toBe("foo")
  })

  it("reports the same clash discovered in the other order", () => {
    const issue = issueFor([file("foo/bar.jpg"), file("foo")])

    expect(issue?.reason).toBe("file_directory_collision")
  })

  it("reports a directory entry clashing with a file of the same path", () => {
    const issue = issueFor([file("foo"), dir("foo/")])

    expect(issue?.reason).toBe("file_directory_collision")
  })

  it("allows a folder and a file that merely share a prefix", () => {
    // `posts` vs `posts-archive` is not a collision.
    expect(issueFor([file("posts/a.png"), file("posts-archive/b.png")])).toBeNull()
  })

  it("allows deep nesting under a shared folder", () => {
    expect(
      issueFor([file("a/b/c.png"), file("a/b/d.png"), file("a/e.png"), dir("a/f/")]),
    ).toBeNull()
  })
})

describe("nothing is ever renamed", () => {
  it("reports the key exactly as it was given", () => {
    const issue = sensitive().inspect(file("posts/../escape.png"))

    // Not a corrected key, not a suggestion — the original. Every stored
    // reference in the database names this exact string.
    expect(issue?.key).toBe("posts/../escape.png")
  })

  it("never proposes a replacement name", () => {
    const issues = [
      sensitive().inspect(file("CON")),
      sensitive().inspect(file("name.")),
      issueFor([file("A.png"), file("a.png")], false),
    ]

    for (const issue of issues) {
      expect(issue?.detail).not.toMatch(/rename|renamed to|will be|instead use/i)
    }
  })
})

describe("probing the destination filesystem", () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "flowcms-case-"))
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it("answers for the real filesystem rather than guessing from the platform", async () => {
    const result = (await probeDestinationCaseSensitivity(workspace)).sensitivity

    // The value depends on the host, so the assertion is about the SHAPE of the
    // answer. What matters is that it came from the filesystem: a Linux
    // container can mount a case-insensitive volume and macOS is
    // case-insensitive by default, so `process.platform` is a guess.
    expect(["sensitive", "insensitive"]).toContain(result)
  })

  it("agrees with what the filesystem actually does", async () => {
    const sensitiveResult =
      (await probeDestinationCaseSensitivity(workspace)).sensitivity === "sensitive"

    // Independent confirmation, by the same mechanism the probe uses.
    const { writeFileSync, statSync } = await import("node:fs")
    writeFileSync(join(workspace, "probe-check"), "x")
    let insensitiveFs = false
    try {
      statSync(join(workspace, "PROBE-CHECK"))
      insensitiveFs = true
    } catch {
      insensitiveFs = false
    }

    expect(sensitiveResult).toBe(!insensitiveFs)
  })

  it("leaves no probe artefact behind", async () => {
    await probeDestinationCaseSensitivity(workspace)

    expect(readdirSync(workspace).filter((n) => n.toLowerCase().includes("case-probe"))).toEqual([])
  })

  it("creates the root if it does not exist yet", async () => {
    const fresh = join(workspace, "not-created")

    expect(["sensitive", "insensitive"]).toContain(
      (await probeDestinationCaseSensitivity(fresh)).sensitivity,
    )
  })

  it("reports UNKNOWN when it cannot probe, rather than assuming", async () => {
    // CHANGED IN PHASE 4b1, and the Phase 4a fallback was unsafe.
    //
    // It returned "case-sensitive" on a failed probe, on the reasoning that
    // sensitivity keeps two keys distinct. But the danger runs the other way:
    // if the destination is really case-INSENSITIVE, treating it as sensitive
    // lets `Photo.png` and `photo.png` both through, the second overwrites the
    // first at the destination, and the migration reports success with one file
    // gone.
    const { writeFileSync } = await import("node:fs")
    const occupied = join(workspace, "a-file")
    writeFileSync(occupied, "not a directory")

    const probe = await probeDestinationCaseSensitivity(join(occupied, "nested"))
    expect(probe.sensitivity).toBe("unknown")
  })

  it("explains an unknown result without leaking a path or an errno", async () => {
    const { writeFileSync } = await import("node:fs")
    const occupied = join(workspace, "another-file")
    writeFileSync(occupied, "not a directory")

    const probe = await probeDestinationCaseSensitivity(join(occupied, "nested"))

    expect(probe.detail).toBeTruthy()
    expect(probe.detail).not.toContain(workspace)
    expect(probe.detail).not.toMatch(/ENOTDIR|ENOENT|EACCES/)
  })

  it.skipIf(process.platform === "win32")("reports unknown when the directory is unwritable", async () => {
    const { mkdirSync, chmodSync } = await import("node:fs")
    const readonly = join(workspace, "readonly-probe")
    mkdirSync(readonly)
    chmodSync(readonly, 0o500)

    const probe = await probeDestinationCaseSensitivity(readonly)
    chmodSync(readonly, 0o700)

    expect(probe.sensitivity).toBe("unknown")
    expect(probe.detail).toMatch(/permission/i)
  })
})

describe("an unknown case behaviour blocks the migration", () => {
  it("produces a blocking problem", () => {
    const blocker = caseSensitivityBlocker({ sensitivity: "unknown", detail: "permission denied" })

    expect(blocker).toBeTruthy()
    expect(blocker).toMatch(/could not determine/i)
    // And it says what the risk is, since "unknown" alone is not actionable.
    expect(blocker).toMatch(/overwrite|silently/i)
  })

  it("does not block when the answer is known", () => {
    expect(caseSensitivityBlocker({ sensitivity: "sensitive" })).toBeNull()
    expect(caseSensitivityBlocker({ sensitivity: "insensitive" })).toBeNull()
  })

  it("is reported once for the destination, not once per key", () => {
    // A fact about the destination, not about any particular key. Reporting it
    // against half a million keys would bury it.
    const blocker = caseSensitivityBlocker({ sensitivity: "unknown" })
    expect(blocker).not.toContain("key")
  })
})

describe("simulated destinations", () => {
  it("treats a case-insensitive destination's keys as one", () => {
    const scanner = createCompatibilityScanner({ caseSensitivity: "insensitive" })
    expect(scanner.inspect(file("Logo.PNG"))).toBeNull()
    expect(scanner.inspect(file("logo.png"))?.reason).toBe("case_collision")
  })

  it("treats a case-sensitive destination's keys as distinct", () => {
    const scanner = createCompatibilityScanner({ caseSensitivity: "sensitive" })
    expect(scanner.inspect(file("Logo.PNG"))).toBeNull()
    expect(scanner.inspect(file("logo.png"))).toBeNull()
  })
})
