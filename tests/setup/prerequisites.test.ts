import { afterEach, describe, expect, it, vi } from "vitest"
import {
  SETUP_PROBE_PREFIX,
  buildPrerequisites,
  checkStoragePrerequisite,
} from "@/Framework/Setup/prerequisites"
import { StorageService } from "@/Framework/Storage/StorageService"
import { StorageConfigurationError } from "@/Framework/Storage/StorageErrors"

/**
 * What a deployment must be able to DO before its installation may be marked
 * initialized.
 *
 * The gate is a pure function so the policy can be pinned exhaustively, and the
 * storage probe is a real round-trip so it proves the thing that matters:
 * every upload goes through the active driver, so a credential that can list
 * but not write passes a bucket check and fails every upload the operator ever
 * makes.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe("the completion gate", () => {
  it("is satisfied only when database, storage, captcha AND auth config are ready", () => {
    expect(
      buildPrerequisites({
        database: "ready",
        storage: "ready",
        captcha: "ready",
        auth: "ready",
      }).satisfied,
    ).toBe(true)
  })

  it.each([
    ["database unavailable", { database: "unavailable", storage: "ready", captcha: "ready", auth: "ready" }],
    ["migrations pending", { database: "migrations_pending", storage: "ready", captcha: "ready", auth: "ready" }],
    ["storage not configured", { database: "ready", storage: "not_configured", captcha: "ready", auth: "ready" }],
    ["storage unavailable", { database: "ready", storage: "unavailable", captcha: "ready", auth: "ready" }],
    ["captcha secret missing", { database: "ready", storage: "ready", captcha: "missing", auth: "ready" }],
    ["everything broken", { database: "unavailable", storage: "unavailable", captcha: "missing", auth: "missing" }],
  ] as const)("is NOT satisfied with %s", (_label, checks) => {
    expect(buildPrerequisites(checks).satisfied).toBe(false)
  })

  it("requires storage, which /api/ready deliberately does not", () => {
    // The two answer different questions. A container must be able to SERVE the
    // page that tells an operator their storage is broken, so readiness cannot
    // gate on storage — but completing setup without usable media storage hands
    // that operator an admin panel where every upload fails, at exactly the
    // moment the configuration was easiest to fix.
    expect(
      buildPrerequisites({ database: "ready", storage: "not_configured", captcha: "ready", auth: "ready" })
        .satisfied,
    ).toBe(false)
  })

  it("never consults Redis", () => {
    // Redis is optional everywhere else in FlowCMS and must not become
    // mandatory by the back door. The gate's inputs are the proof: there is no
    // third field to pass.
    const gate = buildPrerequisites({ database: "ready", storage: "ready", captcha: "ready", auth: "ready" })
    expect(Object.keys(gate).sort()).toEqual(["auth", "captcha", "database", "satisfied", "storage"])
  })

  it("reports the component states it was given, unchanged", () => {
    const gate = buildPrerequisites({ database: "migrations_pending", storage: "unavailable", captcha: "ready", auth: "ready" })
    expect(gate.database).toBe("migrations_pending")
    expect(gate.storage).toBe("unavailable")
  })
})

describe("the storage probe", () => {
  it("writes, reads back, and DELETES its object", async () => {
    // §48: a first-run check must not leave an artefact in somebody's bucket
    // every time the setup page is reloaded.
    const store: Record<string, Buffer> = {}
    const upload = vi
      .spyOn(StorageService, "uploadObject")
      .mockImplementation(async (key, body) => {
        store[key] = Buffer.from(body)
      })
    const download = vi
      .spyOn(StorageService, "downloadObject")
      .mockImplementation(async (key) => store[key])
    const remove = vi.spyOn(StorageService, "deleteObject").mockImplementation(async (key) => {
      delete store[key]
    })

    expect(await checkStoragePrerequisite()).toBe("ready")

    expect(upload).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(store).toEqual({})
  })

  it("namespaces its key so it never looks like operator content", async () => {
    let usedKey = ""
    vi.spyOn(StorageService, "uploadObject").mockImplementation(async (key) => {
      usedKey = key
    })
    vi.spyOn(StorageService, "downloadObject").mockResolvedValue(
      Buffer.from("flowcms setup check\n", "utf8"),
    )
    vi.spyOn(StorageService, "deleteObject").mockResolvedValue(undefined)

    await checkStoragePrerequisite()

    expect(usedKey.startsWith(SETUP_PROBE_PREFIX)).toBe(true)
    // Dot-prefixed, so it sorts away from real folders in the File Manager for
    // the moments it exists.
    expect(SETUP_PROBE_PREFIX.startsWith(".")).toBe(true)
  })

  it("uses a distinct key each time, so concurrent probes cannot collide", async () => {
    const keys: string[] = []
    vi.spyOn(StorageService, "uploadObject").mockImplementation(async (key) => {
      keys.push(key)
    })
    vi.spyOn(StorageService, "downloadObject").mockResolvedValue(
      Buffer.from("flowcms setup check\n", "utf8"),
    )
    vi.spyOn(StorageService, "deleteObject").mockResolvedValue(undefined)

    await checkStoragePrerequisite()
    await checkStoragePrerequisite()

    expect(new Set(keys).size).toBe(2)
  })

  it.each([
    ["s3_incomplete", "S3 storage is not fully configured."],
    ["local_path_missing", "STORAGE_DRIVER=local requires LOCAL_STORAGE_PATH."],
    ["driver_invalid", 'STORAGE_DRIVER must be "s3" or "local".'],
  ] as const)("reports not_configured for %s", async (problem, message) => {
    // CLASSIFIED BY TYPE, NOT BY MESSAGE. This used to reject with a plain
    // Error carrying the literal text "S3 is not configured", because that is
    // what the probe matched on. That match was true of every correctly
    // configured LOCAL deployment — which has no S3 credentials by design — so
    // a working filesystem installation would have been told its storage was
    // broken and refused permission to finish setup.
    //
    // All three configuration problems land on the same state because the
    // operator's next action is the same: open the deployment's storage
    // configuration. They are separate CODES so that other callers can tell
    // them apart, and so that this page never has to name which one it was to
    // an anonymous visitor.
    vi.spyOn(StorageService, "uploadObject").mockRejectedValue(
      new StorageConfigurationError(problem, message),
    )
    expect(await checkStoragePrerequisite()).toBe("not_configured")
  })

  it("reports unavailable for a plain error that merely mentions configuration", async () => {
    // The inverse of the rule above: a backend failure whose message happens to
    // contain the old magic words must NOT be mistaken for missing
    // configuration now that classification is by type.
    vi.spyOn(StorageService, "uploadObject").mockRejectedValue(
      new Error("upstream says: S3 is not configured correctly on the proxy"),
    )
    expect(await checkStoragePrerequisite()).toBe("unavailable")
  })

  it("reports unavailable when configured storage rejects the write", async () => {
    // Distinct from not_configured because the operator's next action differs,
    // and reported without any of the detail the error carried.
    vi.spyOn(StorageService, "uploadObject").mockRejectedValue(
      new Error("AccessDenied: user is not authorized to perform s3:PutObject on my-secret-bucket"),
    )
    expect(await checkStoragePrerequisite()).toBe("unavailable")
  })

  it("reports unavailable when the object cannot be read back", async () => {
    // Write-only credentials, or a bucket policy that hides what it accepted.
    vi.spyOn(StorageService, "uploadObject").mockResolvedValue(undefined)
    vi.spyOn(StorageService, "downloadObject").mockRejectedValue(new Error("NoSuchKey"))
    const remove = vi.spyOn(StorageService, "deleteObject").mockResolvedValue(undefined)

    expect(await checkStoragePrerequisite()).toBe("unavailable")
    // Cleanup still runs: the object WAS written, so leaving it would be litter
    // either way.
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("reports unavailable when the content read back does not match", async () => {
    vi.spyOn(StorageService, "uploadObject").mockResolvedValue(undefined)
    vi.spyOn(StorageService, "downloadObject").mockResolvedValue(Buffer.from("something else"))
    vi.spyOn(StorageService, "deleteObject").mockResolvedValue(undefined)

    expect(await checkStoragePrerequisite()).toBe("unavailable")
  })

  it("still reports ready when only the cleanup fails", async () => {
    // A leftover probe object is untidy. It is not a reason to refuse to
    // initialize an installation whose storage demonstrably works.
    vi.spyOn(StorageService, "uploadObject").mockResolvedValue(undefined)
    vi.spyOn(StorageService, "downloadObject").mockResolvedValue(
      Buffer.from("flowcms setup check\n", "utf8"),
    )
    vi.spyOn(StorageService, "deleteObject").mockRejectedValue(new Error("SlowDown"))

    expect(await checkStoragePrerequisite()).toBe("ready")
  })

  it("logs the failure detail to the server, never returns it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(StorageService, "uploadObject").mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.5:9000"),
    )

    const state = await checkStoragePrerequisite()

    // The state is all the browser gets. The endpoint address stays in the log.
    expect(state).toBe("unavailable")
    expect(JSON.stringify(state)).not.toContain("10.0.0.5")
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0][0])).toContain("[flowcms:setup]")
  })
})

/**
 * §7 of Phase 7.1.1: first-run setup may complete ONLY on a deployment that
 * will actually let the operator log in afterwards.
 *
 * Successful setup followed by an unusable admin login is a broken
 * installation, and a uniquely nasty one: setup closes permanently, so the
 * operator is left with an initialized site they can never administer and no
 * supported way to reopen the form.
 *
 * `CAPTCHA_SECRET` is deployment configuration and is NOT asked for in `/setup`.
 * It is integrated as a prerequisite check, alongside database and storage,
 * exactly like every other thing the deployment has to be able to do.
 */
describe("the captcha prerequisite", () => {
  it("blocks completion when the captcha secret is missing", () => {
    expect(
      buildPrerequisites({ database: "ready", storage: "ready", captcha: "missing" }).satisfied,
    ).toBe(false)
  })

  it("blocks completion when the captcha secret is unsafe", () => {
    expect(
      buildPrerequisites({ database: "ready", storage: "ready", captcha: "unsafe" }).satisfied,
    ).toBe(false)
  })

  it("allows completion when the captcha secret is usable", () => {
    expect(
      buildPrerequisites({ database: "ready", storage: "ready", captcha: "ready", auth: "ready" })
        .satisfied,
    ).toBe(true)
  })

  it("reports a state, never anything derived from the secret", () => {
    const gate = buildPrerequisites({ database: "ready", storage: "ready", captcha: "missing" })
    expect(gate.captcha).toBe("missing")
    const serialized = JSON.stringify(gate)
    expect(serialized).not.toMatch(/secret|length|hash|chars/i)
  })

  it("reports the captcha component it was given, unchanged", () => {
    // The full key list is pinned once, in the auth-prerequisite block below.
    expect(
      buildPrerequisites({ database: "ready", storage: "ready", captcha: "unsafe", auth: "ready" })
        .captcha,
    ).toBe("unsafe")
  })

  it("defaults to blocking when no captcha state is supplied", () => {
    // Fails CLOSED. A caller that forgot to check must not thereby be allowed
    // to complete setup — the whole point is that this cannot be skipped.
    expect(buildPrerequisites({ database: "ready", storage: "ready" }).satisfied).toBe(false)
  })
})

/**
 * §8 of Phase 7.1.2: a deployment must not complete first-run setup while its
 * session-signing secret is invalid.
 *
 * The failure this prevents is the worst-shaped one in the product. Completion
 * creates the owner and closes setup PERMANENTLY. Do that with a weak
 * AUTH_SECRET and the installation is not merely broken — it is broken in a way
 * that looks fine: the owner signs in successfully, and so can anyone who can
 * read the value out of this repository, using a session they forged
 * themselves.
 *
 * AUTH_SECRET is deployment configuration and `/setup` never asks for it.
 */
describe("the auth-secret prerequisite", () => {
  const base = { database: "ready", storage: "ready", captcha: "ready" } as const

  it("blocks completion when the auth secret is missing", () => {
    expect(buildPrerequisites({ ...base, auth: "missing" }).satisfied).toBe(false)
  })

  it("blocks completion when the auth secret is unsafe", () => {
    expect(buildPrerequisites({ ...base, auth: "unsafe" }).satisfied).toBe(false)
  })

  it("allows completion when the auth secret is usable", () => {
    expect(buildPrerequisites({ ...base, auth: "ready" }).satisfied).toBe(true)
  })

  it("defaults to blocking when no auth state is supplied", () => {
    // Fails CLOSED, like every other prerequisite: a caller that forgot to
    // check must not thereby be allowed to initialize an installation.
    expect(buildPrerequisites({ database: "ready", storage: "ready", captcha: "ready" }).satisfied).toBe(
      false,
    )
  })

  it.each([
    ["both secrets valid", { captcha: "ready", auth: "ready" }, true],
    ["auth invalid, captcha valid", { captcha: "ready", auth: "missing" }, false],
    ["auth valid, captcha invalid", { captcha: "missing", auth: "ready" }, false],
    ["both invalid", { captcha: "unsafe", auth: "unsafe" }, false],
  ] as const)("%s → satisfied: %s", (_label, secrets, expected) => {
    expect(
      buildPrerequisites({ database: "ready", storage: "ready", ...secrets }).satisfied,
    ).toBe(expected)
  })

  it("reports auth and captcha separately, never collapsed", () => {
    const gate = buildPrerequisites({ database: "ready", storage: "ready", captcha: "missing", auth: "unsafe" })
    expect(gate.captcha).toBe("missing")
    expect(gate.auth).toBe("unsafe")
  })

  it("reports a state, never anything derived from the secret", () => {
    const gate = buildPrerequisites({ ...base, auth: "unsafe" })
    expect(JSON.stringify(gate)).not.toMatch(/secret|length|hash|prefix|chars/i)
  })

  it("keeps the gate to exactly the four things a deployment must be able to do", () => {
    const gate = buildPrerequisites({ ...base, auth: "ready" })
    expect(Object.keys(gate).sort()).toEqual(["auth", "captcha", "database", "satisfied", "storage"])
  })
})
