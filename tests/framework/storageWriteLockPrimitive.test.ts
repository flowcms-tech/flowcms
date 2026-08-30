import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The lock primitive itself, against a failing database.
 *
 * `storageWriteLock.test.ts` drives the GATE with the verdict stubbed. This
 * file drives the VERDICT with the database stubbed, because the behaviour that
 * matters most here is what happens when the query throws — and a test that
 * stubs the answer can never observe that.
 */

const findFirst = vi.fn()
vi.mock("@/db/client", () => ({
  db: { query: { storageMigrations: { findFirst: () => findFirst() } } },
}))
vi.mock("@/db/tables", () => ({ storageMigrations: { status: "status" } }))

const { checkStorageWriteVerdict, isStorageWriteLocked } = await import(
  "@/Framework/Storage/storageWriteLock"
)

beforeEach(() => {
  findFirst.mockReset()
})

describe("reading the lock", () => {
  it("is writable when no job holds it", async () => {
    findFirst.mockResolvedValue(undefined)

    expect(await checkStorageWriteVerdict()).toBe("writable")
    expect(await isStorageWriteLocked()).toBe(false)
  })

  it("is locked while a job is cutting over", async () => {
    findFirst.mockResolvedValue({ id: "job-1" })

    expect(await checkStorageWriteVerdict()).toBe("locked")
    expect(await isStorageWriteLocked()).toBe(true)
  })
})

describe("when the database cannot answer", () => {
  it.each([
    new Error("SQLITE_BUSY: database is locked"),
    new Error("ECONNREFUSED"),
    Object.assign(new Error("relation does not exist"), { code: "42P01" }),
  ])("reports unknown rather than writable", async (error) => {
    findFirst.mockRejectedValue(error)

    expect(await checkStorageWriteVerdict()).toBe("unknown")
  })

  it("treats unknown as locked, so a mutation is refused", async () => {
    // THE POINT OF THE WHOLE FILE. The checkpoint returned `false` here, which
    // let writes through exactly when the answer was unavailable — and the one
    // moment it matters most is a cutover, which is writing to the database
    // throughout. A database failure is therefore the LIKELIEST moment for a
    // stale "unlocked" to do damage, not the least likely.
    findFirst.mockRejectedValue(new Error("SQLITE_BUSY"))

    expect(await isStorageWriteLocked()).toBe(true)
  })

  it("does not swallow the failure into a silent success", async () => {
    findFirst.mockRejectedValue(new Error("boom"))

    // Never `writable`. There is no code path from a thrown query to a
    // permitted mutation.
    expect(await checkStorageWriteVerdict()).not.toBe("writable")
  })
})
