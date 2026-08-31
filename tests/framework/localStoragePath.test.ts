import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  createLocalPathResolver,
  UnsafeStorageKeyError,
} from "@/Framework/Storage/localPath"

/**
 * THE SECURITY BOUNDARY.
 *
 * Under S3 an object key is an opaque string: `../../etc/passwd` is a valid key
 * naming a valid object, and nothing escapes anywhere. The moment keys become
 * filesystem paths that stops being true, and the File Manager's routes are no
 * help — only ONE of them (`POST /api/file-manager`) sanitises anything. Every
 * other route takes `key`, `prefix` or `destination` straight from the request
 * body and hands it to the storage layer:
 *
 *   file/route.ts DELETE          body.key, unvalidated
 *   file/route.ts PATCH           rejects "/" in the name but not ".."
 *   directory/route.ts DELETE     body.prefix, unvalidated, into deletePrefix
 *   file|directory move/copy      body.destination, unvalidated
 *
 * So containment cannot live in the routes. It lives here, and every test below
 * is a thing an authenticated admin could otherwise do to the host filesystem.
 */

let workspace: string
let root: string
let outside: string

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-path-"))
  root = join(workspace, "storage")
  outside = join(workspace, "outside")
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, "secret.txt"), "do not read me")

  // THE EXPECTATIONS BELOW MUST BE IN THE SAME NAMESPACE THE RESOLVER ANSWERS
  // IN, and the resolver deliberately answers in real paths: it resolves its
  // root through `realpath` so that a root reached VIA a symlink does not make
  // every operation under it look like an escape.
  //
  // The temporary directory is exactly such a root on two of the three
  // platforms this suite runs on, and neither is exotic:
  //
  //   macOS    `/var/folders/…` is a symlink to `/private/var/folders/…`
  //   Windows  `os.tmpdir()` can hand back an 8.3 short name — the GitHub
  //            runner returns `C:\Users\RUNNER~1\…` for `C:\Users\runneradmin\…`
  //
  // Comparing against the raw path passed silently on Linux and on a
  // developer machine whose TEMP is already a long real path, and failed on
  // both CI runners. Resolving here keeps the assertions about containment
  // rather than about how the operating system spells a directory.
  root = realpathSync(root)
  outside = realpathSync(outside)
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

async function resolver() {
  return createLocalPathResolver(root)
}

/** Every key that must be refused before it ever becomes a path. */
const HOSTILE_KEYS: { label: string; key: string }[] = [
  { label: "parent traversal", key: "../secret.txt" },
  { label: "nested parent traversal", key: "posts/../../secret.txt" },
  { label: "traversal that returns inside", key: "posts/../posts/a.png" },
  { label: "trailing traversal", key: "posts/.." },
  { label: "bare dot segment", key: "posts/./a.png" },
  { label: "POSIX absolute path", key: "/etc/passwd" },
  { label: "Windows drive path", key: "C:/Windows/win.ini" },
  { label: "Windows drive path, backslashes", key: "C:\\Windows\\win.ini" },
  { label: "lowercase drive path", key: "d:/data/x.png" },
  { label: "UNC path", key: "\\\\server\\share\\x.png" },
  { label: "UNC path, forward slashes", key: "//server/share/x.png" },
  { label: "backslash traversal", key: "..\\secret.txt" },
  { label: "backslash separator", key: "posts\\a.png" },
  { label: "mixed separator traversal", key: "posts/..\\..\\secret.txt" },
  { label: "null byte", key: "posts/a.png\u0000.txt" },
  { label: "bare null byte", key: "\u0000" },
  { label: "empty interior segment", key: "posts//a.png" },
]

/**
 * Refused as an OBJECT KEY but meaningful as a PREFIX.
 *
 * `""` is the File Manager's opening screen — the root listing is
 * `listDirectory("")` — and `"/"` is the same thing spelled with a separator,
 * which is how `sanitizePrefix` in `objectKey.ts` already treats it. Both
 * resolve to the root exactly, so neither escapes anything.
 */
const ROOT_MEANING_KEYS = ["", "/"]

describe("keys that must never become a path", () => {
  it.each(HOSTILE_KEYS)("refuses $label", async ({ key }) => {
    const paths = await resolver()
    await expect(paths.resolveFile(key)).rejects.toBeInstanceOf(UnsafeStorageKeyError)
  })

  it.each(HOSTILE_KEYS)("refuses $label as a prefix too", async ({ key }) => {
    // Prefixes reach `deletePrefix`, which removes a whole tree. If prefix
    // validation were weaker than key validation, `../..` would be a recursive
    // delete of the parent directory.
    const paths = await resolver()
    await expect(paths.resolvePrefix(key)).rejects.toBeInstanceOf(UnsafeStorageKeyError)
  })

  it.each(ROOT_MEANING_KEYS)("refuses %j as an object key", async (key) => {
    const paths = await resolver()
    await expect(paths.resolveFile(key)).rejects.toBeInstanceOf(UnsafeStorageKeyError)
  })

  it.each(ROOT_MEANING_KEYS)("accepts %j as a prefix, meaning the root", async (key) => {
    const paths = await resolver()
    expect(await paths.resolvePrefix(key)).toBe(root)
  })
})

describe("percent-encoded traversal", () => {
  it("treats %2e%2e as a literal name, never as a traversal", async () => {
    const paths = await resolver()

    // The driver must NOT decode. Routes decode before calling it, and a second
    // decode here would turn a legitimately-named object into an escape — a
    // classic double-decode bug. `%2e%2e` is a perfectly ordinary filename.
    const resolved = await paths.resolveFile("posts/%2e%2e/a.png")

    expect(resolved.startsWith(root + sep)).toBe(true)
    expect(resolved).toContain(`%2e%2e${sep}a.png`)
  })

  it("still refuses the decoded form", async () => {
    const paths = await resolver()
    await expect(paths.resolveFile("posts/../a.png")).rejects.toBeInstanceOf(
      UnsafeStorageKeyError,
    )
  })
})

describe("keys that are legitimate", () => {
  it.each([
    "a.png",
    "posts/a.png",
    "posts/2026/01/deep/nested/a.png",
    "posts/file with spaces.png",
    "posts/файл.png",
    "posts/日本語.png",
    "posts/emoji-🎉.png",
    "posts/dots...in.name.png",
    "posts/.hidden.png",
  ])("accepts %s and keeps it inside the root", async (key) => {
    const paths = await resolver()
    const resolved = await paths.resolveFile(key)

    expect(resolved.startsWith(root + sep)).toBe(true)
  })

  it("maps POSIX key separators onto the host separator", async () => {
    const paths = await resolver()

    const resolved = await paths.resolveFile("posts/2026/a.png")

    // Keys are POSIX on every platform; only the resolved path is host-shaped.
    expect(resolved).toBe(join(root, "posts", "2026", "a.png"))
  })

  it("treats the empty prefix as the root itself", async () => {
    const paths = await resolver()
    expect(await paths.resolvePrefix("")).toBe(root)
  })

  it("accepts a prefix with or without its trailing slash", async () => {
    const paths = await resolver()

    expect(await paths.resolvePrefix("posts/")).toBe(join(root, "posts"))
    expect(await paths.resolvePrefix("posts")).toBe(join(root, "posts"))
  })
})

describe("file keys versus prefixes", () => {
  it("refuses a file key that ends in a slash", async () => {
    // A trailing slash means "directory" in this vocabulary. Writing an object
    // at `posts/` is the S3 folder-marker trick, which the local driver
    // represents with a real directory instead.
    const paths = await resolver()
    await expect(paths.resolveFile("posts/")).rejects.toBeInstanceOf(UnsafeStorageKeyError)
  })
})

describe("symlink escape", () => {
  let linkSupported = true

  beforeAll(() => {
    // Creating a symlink on Windows needs Developer Mode or elevation. Where it
    // is unavailable the escape it guards against is unavailable too, so the
    // tests below report that rather than failing.
    try {
      symlinkSync(outside, join(root, "escape-probe"), "junction")
      rmSync(join(root, "escape-probe"), { recursive: true, force: true })
    } catch {
      linkSupported = false
    }
  })

  it("refuses a key whose parent directory is a symlink pointing outside", async () => {
    if (!linkSupported) return
    symlinkSync(outside, join(root, "linked-dir"), "junction")

    const paths = await resolver()
    // Lexically this is `<root>/linked-dir/secret.txt` — inside the root. Only
    // resolving the real path reveals that it is really `<outside>/secret.txt`.
    await expect(paths.resolveFile("linked-dir/secret.txt")).rejects.toBeInstanceOf(
      UnsafeStorageKeyError,
    )

    rmSync(join(root, "linked-dir"), { recursive: true, force: true })
  })

  it("refuses a file that is itself a symlink pointing outside", async () => {
    if (!linkSupported) return
    try {
      symlinkSync(join(outside, "secret.txt"), join(root, "leak.png"), "file")
    } catch {
      return
    }

    const paths = await resolver()
    await expect(paths.resolveFile("leak.png")).rejects.toBeInstanceOf(UnsafeStorageKeyError)

    rmSync(join(root, "leak.png"), { force: true })
  })

  it("refuses a symlink even when it points back inside the root", async () => {
    if (!linkSupported) return
    mkdirSync(join(root, "real"), { recursive: true })
    writeFileSync(join(root, "real", "a.png"), "x")
    try {
      symlinkSync(join(root, "real", "a.png"), join(root, "alias.png"), "file")
    } catch {
      return
    }

    const paths = await resolver()
    // Fails CLOSED. FlowCMS never creates a symlink, so one that exists was
    // planted; refusing all of them is a rule with no exceptions to get wrong,
    // and it costs nothing because there is no legitimate case.
    await expect(paths.resolveFile("alias.png")).rejects.toBeInstanceOf(UnsafeStorageKeyError)

    rmSync(join(root, "alias.png"), { force: true })
    rmSync(join(root, "real"), { recursive: true, force: true })
  })
})

describe("the root itself", () => {
  it("resolves the root through its own real path", async () => {
    // The root may itself be reached through a symlink — /tmp is one on macOS.
    // Containment is checked against the REAL root, or every operation on a
    // macOS temp directory would look like an escape.
    const paths = await resolver()
    expect(paths.root).toBe(root)
  })

  it("creates the root when it does not exist yet", async () => {
    const fresh = join(workspace, "not-created-yet")
    const paths = await createLocalPathResolver(fresh)

    expect(paths.root).toBe(fresh)
    expect(await paths.resolvePrefix("")).toBe(fresh)
  })
})
