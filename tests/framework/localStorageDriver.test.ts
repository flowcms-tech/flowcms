import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createLocalStorageDriver } from "@/Framework/Storage/drivers/LocalStorageDriver"
import {
  StorageObjectNotFoundError,
  UnsafeStorageKeyError,
} from "@/Framework/Storage/StorageErrors"
import type { StorageDriver } from "@/Framework/Storage/StorageDriver"

/**
 * The filesystem backend.
 *
 * Every test drives a REAL temporary directory rather than a mocked `fs`. A
 * mocked filesystem would happily agree with whatever the driver believed about
 * symlinks, `EXDEV`, empty directories and case sensitivity — which are exactly
 * the things that make a filesystem backend different from an object store, and
 * therefore exactly the things worth testing.
 */

let workspace: string
let root: string
let outside: string
let driver: StorageDriver

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-local-"))
  root = join(workspace, "storage")
  outside = join(workspace, "outside")
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, "secret.txt"), "do not touch me")
  driver = createLocalStorageDriver(root)
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

const bytes = (s: string) => Buffer.from(s, "utf8")
const text = (b: Buffer) => Buffer.from(b).toString("utf8")

describe("identity", () => {
  it("names itself local", () => {
    expect(driver.name).toBe("local")
  })

  it("creates its root on first use rather than requiring one to exist", async () => {
    expect(existsSync(root)).toBe(false)

    await driver.uploadObject("a.txt", bytes("x"))

    expect(existsSync(root)).toBe(true)
  })
})

describe("objects", () => {
  it("round-trips an upload", async () => {
    await driver.uploadObject("posts/a.txt", bytes("hello"))

    expect(text(await driver.downloadObject("posts/a.txt"))).toBe("hello")
  })

  it("creates missing parent directories on upload", async () => {
    await driver.uploadObject("a/b/c/d/deep.txt", bytes("deep"))

    expect(text(await driver.downloadObject("a/b/c/d/deep.txt"))).toBe("deep")
  })

  it("overwrites an existing object completely", async () => {
    await driver.uploadObject("a.txt", bytes("a much longer original value"))
    await driver.uploadObject("a.txt", bytes("short"))

    // Truncation matters: writing over a longer file without truncating leaves
    // a tail of the old content, which would corrupt every replaced image.
    expect(text(await driver.downloadObject("a.txt"))).toBe("short")
  })

  it("stores bytes verbatim, not text", async () => {
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe])
    await driver.uploadObject("img.png", binary)

    expect([...(await driver.downloadObject("img.png"))]).toEqual([...binary])
  })

  it("reports a missing object as StorageObjectNotFoundError", async () => {
    await expect(driver.downloadObject("nope.txt")).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    )
  })

  it("deletes an object", async () => {
    await driver.uploadObject("a.txt", bytes("x"))
    await driver.deleteObject("a.txt")

    await expect(driver.downloadObject("a.txt")).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    )
  })

  it("treats deleting a missing object as success, matching S3", async () => {
    // S3's DeleteObject is idempotent and returns 204 for a key that was never
    // there. A local driver that threw would make the File Manager's delete
    // fail on a double-click.
    await expect(driver.deleteObject("never-existed.txt")).resolves.toBeUndefined()
  })

  it("copies an object, leaving the source in place", async () => {
    await driver.uploadObject("posts/a.txt", bytes("body"))
    await driver.copyObject("posts/a.txt", "archive/nested/a.txt")

    expect(text(await driver.downloadObject("archive/nested/a.txt"))).toBe("body")
    expect(text(await driver.downloadObject("posts/a.txt"))).toBe("body")
  })

  it("renames an object, removing the source", async () => {
    await driver.uploadObject("posts/a.txt", bytes("body"))
    await driver.renameObject("posts/a.txt", "posts/b.txt")

    expect(text(await driver.downloadObject("posts/b.txt"))).toBe("body")
    await expect(driver.downloadObject("posts/a.txt")).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    )
  })

  it("renames into a directory that does not exist yet", async () => {
    await driver.uploadObject("a.txt", bytes("body"))
    await driver.renameObject("a.txt", "brand/new/place/a.txt")

    expect(text(await driver.downloadObject("brand/new/place/a.txt"))).toBe("body")
  })

  it("leaves the source alone when a copy fails", async () => {
    await driver.uploadObject("a.txt", bytes("body"))

    await expect(driver.copyObject("a.txt", "../escape.txt")).rejects.toBeInstanceOf(
      UnsafeStorageKeyError,
    )
    expect(text(await driver.downloadObject("a.txt"))).toBe("body")
  })
})

describe("unicode and awkward names", () => {
  it.each(["файл.png", "日本語.png", "emoji-🎉.png", "with space.png", "dots...png"])(
    "round-trips %s",
    async (name) => {
      await driver.uploadObject(`posts/${name}`, bytes("x"))

      expect(text(await driver.downloadObject(`posts/${name}`))).toBe("x")
      const listing = await driver.listDirectory("posts/")
      expect(listing.files.map((f) => f.key)).toContain(`posts/${name}`)
    },
  )

  it("keeps a percent-encoded name literal", async () => {
    // The driver must not decode: `%2e%2e` is a filename, not a traversal.
    await driver.uploadObject("posts/%2e%2e.png", bytes("x"))

    const listing = await driver.listDirectory("posts/")
    expect(listing.files.map((f) => f.key)).toEqual(["posts/%2e%2e.png"])
  })
})

describe("directories", () => {
  it("creates an empty directory that survives listing", async () => {
    await driver.createDirectory("empty/")

    // The point of the S3 zero-byte marker is that an empty folder still shows
    // up. A real directory has to behave the same way.
    const listing = await driver.listDirectory("")
    expect(listing.directories).toEqual(["empty/"])
    expect(listing.files).toEqual([])
  })

  it("creates nested directories in one call", async () => {
    await driver.createDirectory("a/b/c/")

    expect((await driver.listDirectory("a/b/")).directories).toEqual(["a/b/c/"])
  })

  it("is idempotent", async () => {
    await driver.createDirectory("a/")
    await expect(driver.createDirectory("a/")).resolves.toBeUndefined()
  })

  it("lists directories and files at one level only", async () => {
    await driver.uploadObject("posts/a.txt", bytes("x"))
    await driver.uploadObject("posts/nested/deep.txt", bytes("x"))
    await driver.uploadObject("top.txt", bytes("x"))

    const listing = await driver.listDirectory("posts/")

    expect(listing.directories).toEqual(["posts/nested/"])
    expect(listing.files.map((f) => f.key)).toEqual(["posts/a.txt"])
  })

  it("lists the root", async () => {
    await driver.uploadObject("top.txt", bytes("x"))
    await driver.createDirectory("folder/")

    const listing = await driver.listDirectory("")

    expect(listing.directories).toEqual(["folder/"])
    expect(listing.files.map((f) => f.key)).toEqual(["top.txt"])
  })

  it("returns an empty listing for a prefix that does not exist", async () => {
    // S3 answers an unknown prefix with an empty result rather than an error,
    // and the File Manager renders that as an empty folder.
    expect(await driver.listDirectory("nope/")).toEqual({ directories: [], files: [] })
  })

  it("does not confuse directories that share a prefix", async () => {
    await driver.uploadObject("posts/a.txt", bytes("x"))
    await driver.uploadObject("posts-archive/b.txt", bytes("x"))
    await driver.uploadObject("postsomething/c.txt", bytes("x"))

    const listing = await driver.listDirectory("posts/")

    expect(listing.files.map((f) => f.key)).toEqual(["posts/a.txt"])
    expect(listing.directories).toEqual([])
  })

  it("does not confuse files that share a prefix", async () => {
    await driver.uploadObject("a.txt", bytes("one"))
    await driver.uploadObject("a.txt.bak", bytes("two"))

    expect(text(await driver.downloadObject("a.txt"))).toBe("one")
    expect(text(await driver.downloadObject("a.txt.bak"))).toBe("two")
  })

  it("reports size and a real modification time", async () => {
    await driver.uploadObject("a.txt", bytes("12345"))

    const [file] = (await driver.listDirectory("")).files
    expect(file.size).toBe(5)
    expect(file.lastModified).toBeInstanceOf(Date)
    expect(file.lastModified.getTime()).toBeGreaterThan(0)
  })

  it("sorts its output, so two backends agree on order", async () => {
    for (const name of ["c.txt", "a.txt", "b.txt"]) {
      await driver.uploadObject(name, bytes("x"))
    }
    for (const name of ["zz", "aa", "mm"]) {
      await driver.createDirectory(`${name}/`)
    }

    const listing = await driver.listDirectory("")

    // `readdir` order is filesystem-defined; S3 returns keys in binary order.
    // Sorting is what makes the two drivers interchangeable to a caller.
    expect(listing.files.map((f) => f.key)).toEqual(["a.txt", "b.txt", "c.txt"])
    expect(listing.directories).toEqual(["aa/", "mm/", "zz/"])
  })
})

describe("listObjects", () => {
  it("returns every object beneath a prefix, at any depth", async () => {
    await driver.uploadObject("posts/a.txt", bytes("x"))
    await driver.uploadObject("posts/nested/b.txt", bytes("x"))
    await driver.uploadObject("posts/nested/deeper/c.txt", bytes("x"))
    await driver.uploadObject("other/d.txt", bytes("x"))

    const keys = (await driver.listObjects("posts/")).map((o) => o.key)

    expect(keys).toEqual([
      "posts/a.txt",
      "posts/nested/b.txt",
      "posts/nested/deeper/c.txt",
    ])
  })

  it("returns everything when given no prefix", async () => {
    await driver.uploadObject("a.txt", bytes("x"))
    await driver.uploadObject("deep/b.txt", bytes("x"))

    expect((await driver.listObjects()).map((o) => o.key)).toEqual(["a.txt", "deep/b.txt"])
  })

  it("returns an empty list for a missing prefix", async () => {
    expect(await driver.listObjects("nope/")).toEqual([])
  })

  it("lists no entry for a directory itself", async () => {
    // S3 would list a zero-byte marker here; a filesystem has a real directory
    // and no object. This is the one place the two backends genuinely differ,
    // and it is recorded rather than papered over.
    await driver.createDirectory("empty/")

    expect(await driver.listObjects("")).toEqual([])
  })
})

describe("prefix operations", () => {
  beforeEach(async () => {
    await driver.uploadObject("posts/a.txt", bytes("a"))
    await driver.uploadObject("posts/nested/b.txt", bytes("b"))
    await driver.createDirectory("posts/empty/")
  })

  it("copies a whole tree, leaving the source in place", async () => {
    await driver.copyPrefix("posts/", "archive/")

    expect(text(await driver.downloadObject("archive/a.txt"))).toBe("a")
    expect(text(await driver.downloadObject("archive/nested/b.txt"))).toBe("b")
    expect(text(await driver.downloadObject("posts/a.txt"))).toBe("a")
  })

  it("carries empty directories through a copy", async () => {
    await driver.copyPrefix("posts/", "archive/")

    expect((await driver.listDirectory("archive/")).directories).toContain("archive/empty/")
  })

  it("merges into an existing destination, as an S3 prefix copy does", async () => {
    await driver.uploadObject("archive/existing.txt", bytes("kept"))

    await driver.copyPrefix("posts/", "archive/")

    expect(text(await driver.downloadObject("archive/existing.txt"))).toBe("kept")
    expect(text(await driver.downloadObject("archive/a.txt"))).toBe("a")
  })

  it("renames a whole tree, removing the source", async () => {
    await driver.renamePrefix("posts/", "archive/")

    expect(text(await driver.downloadObject("archive/nested/b.txt"))).toBe("b")
    expect(await driver.listDirectory("posts/")).toEqual({ directories: [], files: [] })
  })

  it("renames into an existing destination by merging", async () => {
    await driver.uploadObject("archive/existing.txt", bytes("kept"))

    await driver.renamePrefix("posts/", "archive/")

    expect(text(await driver.downloadObject("archive/existing.txt"))).toBe("kept")
    expect(text(await driver.downloadObject("archive/a.txt"))).toBe("a")
    expect(await driver.listDirectory("posts/")).toEqual({ directories: [], files: [] })
  })

  it("deletes a prefix and everything under it", async () => {
    await driver.deletePrefix("posts/")

    expect(await driver.listDirectory("")).toEqual({ directories: [], files: [] })
  })

  it("deletes an empty prefix without complaint", async () => {
    await driver.createDirectory("lonely/")
    await expect(driver.deletePrefix("lonely/")).resolves.toBeUndefined()
  })

  it("treats deleting a missing prefix as success", async () => {
    await expect(driver.deletePrefix("never-existed/")).resolves.toBeUndefined()
  })

  it("empties the root without destroying it when given the empty prefix", async () => {
    await driver.deletePrefix("")

    expect(await driver.listDirectory("")).toEqual({ directories: [], files: [] })
    // The root must survive: the next upload has to work without anything
    // re-creating it, and on Docker it is a mount point that cannot be removed.
    expect(existsSync(root)).toBe(true)
    await expect(driver.uploadObject("after.txt", bytes("x"))).resolves.toBeUndefined()
  })
})

describe("containment is enforced by the driver, not by its callers", () => {
  /**
   * Each entry is an operation an authenticated admin can reach today through a
   * File Manager route that performs NO key validation of its own.
   */
  const attacks: { label: string; run: (d: StorageDriver) => Promise<unknown> }[] = [
    { label: "download outside the root", run: (d) => d.downloadObject("../outside/secret.txt") },
    { label: "upload outside the root", run: (d) => d.uploadObject("../outside/planted.txt", bytes("x")) },
    { label: "delete outside the root", run: (d) => d.deleteObject("../outside/secret.txt") },
    { label: "recursive delete outside the root", run: (d) => d.deletePrefix("../outside/") },
    { label: "list outside the root", run: (d) => d.listDirectory("../outside/") },
    { label: "recursive list outside the root", run: (d) => d.listObjects("../outside/") },
    { label: "create a directory outside the root", run: (d) => d.createDirectory("../outside/new/") },
    { label: "copy out of the root", run: (d) => d.copyObject("a.txt", "../outside/leak.txt") },
    { label: "copy in from outside the root", run: (d) => d.copyObject("../outside/secret.txt", "stolen.txt") },
    { label: "rename out of the root", run: (d) => d.renameObject("a.txt", "../outside/leak.txt") },
    { label: "copy a tree out of the root", run: (d) => d.copyPrefix("posts/", "../outside/") },
    { label: "rename a tree out of the root", run: (d) => d.renamePrefix("posts/", "../outside/") },
    { label: "absolute POSIX path", run: (d) => d.downloadObject("/etc/passwd") },
    { label: "Windows drive path", run: (d) => d.downloadObject("C:/Windows/win.ini") },
    { label: "backslash traversal", run: (d) => d.downloadObject("..\\outside\\secret.txt") },
    { label: "null byte", run: (d) => d.downloadObject("a.txt\u0000.png") },
  ]

  it.each(attacks)("refuses to $label", async ({ run }) => {
    await driver.uploadObject("a.txt", bytes("x"))
    await driver.uploadObject("posts/a.txt", bytes("x"))

    await expect(run(driver)).rejects.toBeInstanceOf(UnsafeStorageKeyError)
  })

  it("leaves the filesystem outside the root completely untouched", async () => {
    await driver.uploadObject("a.txt", bytes("x"))
    for (const { run } of attacks) {
      await run(driver).catch(() => {})
    }

    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("do not touch me")
    expect(existsSync(join(outside, "planted.txt"))).toBe(false)
    expect(existsSync(join(outside, "leak.txt"))).toBe(false)
    expect(existsSync(join(outside, "new"))).toBe(false)
  })
})

/**
 * Windows distinguishes the two, and an unprivileged account can usually create
 * a directory junction but not a file symlink (that needs Developer Mode or
 * elevation). Probing them separately keeps the directory case running on a
 * plain Windows dev machine instead of skipping both, and CI on Linux runs
 * everything.
 *
 * `skipIf` rather than an early `return`: a test that returns early REPORTS AS
 * PASSED, which is how a security test quietly stops testing anything.
 */
function probeLink(kind: "file" | "junction"): boolean {
  const probeDir = mkdtempSync(join(tmpdir(), "flowcms-linkprobe-"))
  try {
    const target = kind === "file" ? join(probeDir, "t.txt") : join(probeDir, "t")
    if (kind === "file") writeFileSync(target, "x")
    else mkdirSync(target)
    symlinkSync(target, join(probeDir, "link"), kind)
    return true
  } catch {
    return false
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
}

const CAN_FILE_SYMLINK = probeLink("file")
const CAN_DIR_SYMLINK = probeLink("junction")

describe("symlinks are never followed", () => {
  it.skipIf(!CAN_FILE_SYMLINK)("refuses to read through a planted symlink", async () => {
    mkdirSync(root, { recursive: true })
    symlinkSync(join(outside, "secret.txt"), join(root, "leak.txt"), "file")

    await expect(driver.downloadObject("leak.txt")).rejects.toBeInstanceOf(
      UnsafeStorageKeyError,
    )
  })

  it.skipIf(!CAN_DIR_SYMLINK)("refuses to traverse a planted directory symlink", async () => {
    mkdirSync(root, { recursive: true })
    symlinkSync(outside, join(root, "linked"), "junction")

    await expect(driver.downloadObject("linked/secret.txt")).rejects.toBeInstanceOf(
      UnsafeStorageKeyError,
    )
  })

  it.skipIf(!CAN_FILE_SYMLINK)(
    "hides symlinks from listings rather than presenting them as files",
    async () => {
      await driver.uploadObject("real.txt", bytes("x"))
      symlinkSync(join(outside, "secret.txt"), join(root, "fake.txt"), "file")

      const listing = await driver.listDirectory("")

      // Listing one would invite a caller to fetch it, and would show an
      // implementation artefact as if an operator had uploaded it.
      expect(listing.files.map((f) => f.key)).toEqual(["real.txt"])
    },
  )

  it.skipIf(!CAN_FILE_SYMLINK)("does not propagate a symlink through a prefix copy", async () => {
    await driver.uploadObject("posts/real.txt", bytes("real"))
    symlinkSync(join(outside, "secret.txt"), join(root, "posts", "link.txt"), "file")

    await driver.copyPrefix("posts/", "archive/")

    // Two failures this catches, and the second is the one that actually
    // happened: dereferencing would put the secret's CONTENT inside the storage
    // root, and copying the link VERBATIM would put a live escape hatch at a
    // second path inside the root. Neither is acceptable, so nothing is copied.
    expect(existsSync(join(root, "archive", "link.txt"))).toBe(false)
    // The rest of the tree still copies — skipping links is not skipping files.
    expect(text(await driver.downloadObject("archive/real.txt"))).toBe("real")
  })

  it("records which symlink kinds this host could actually exercise", () => {
    // Not a tautology: it puts the coverage gap in the test output, so a run
    // that skipped the file-symlink cases says so out loud instead of looking
    // like a clean sweep.
    expect({ file: CAN_FILE_SYMLINK, directory: CAN_DIR_SYMLINK }).toBeDefined()
    if (!CAN_FILE_SYMLINK) {
      console.warn(
        "[localStorageDriver] file symlinks unavailable on this host; " +
          "those containment cases were skipped (they run on CI).",
      )
    }
  })
})
