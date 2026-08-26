import { describe, expect, it } from "vitest"
import {
  ROLES,
  canApprove,
  canAssignRole,
  canBulkEditPosts,
  canChangeRole,
  canCreatePreviewLink,
  canDemoteOwner,
  canEditPost,
  canManageSettings,
  canManageUsers,
  canModerateQuestions,
  canPermanentlyDeletePost,
  canPublish,
  canSubmitForReview,
  canTrashPost,
  isRole,
  resolveRole,
  type Role,
} from "@/Framework/Auth/permissions"

/**
 * The whole capability matrix. This module is the single source of truth for
 * "who may do what", it is pure, and it had no tests — so every rule below is
 * pinned explicitly rather than derived, on the principle that a test which
 * recomputes the implementation proves nothing.
 */

const ALICE = "user-alice"
const BOB = "user-bob"

describe("isRole", () => {
  it("accepts exactly the four defined roles", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true)
  })

  it("rejects anything else, including near-misses", () => {
    for (const value of [
      "OWNER",
      "Admin",
      "superuser",
      "root",
      "",
      null,
      undefined,
      0,
      1,
      true,
      {},
      [],
      ["admin"],
    ]) {
      expect(isRole(value), String(value)).toBe(false)
    }
  })
})

describe("resolveRole — fails closed", () => {
  it("passes a valid role through untouched", () => {
    for (const role of ROLES) expect(resolveRole(role)).toBe(role)
  })

  it("falls back to the LEAST privileged role, not the most", () => {
    // This used to return "admin". That was defensible exactly once — during
    // the migration that introduced roles, when every pre-existing account had
    // full rights and a restrictive default would have stripped them
    // mid-session. As a permanent default in distributed software it means any
    // unrecognised, missing, or corrupted role value silently becomes an
    // administrator.
    for (const value of [undefined, null, "", "root", "superuser", 42, {}, []]) {
      expect(resolveRole(value), String(value)).toBe("contributor")
    }
  })

  it("gives an unknown role no administrative capability at all", () => {
    const role = resolveRole("something-unrecognised")
    expect(canManageUsers(role)).toBe(false)
    expect(canManageSettings(role)).toBe(false)
    expect(canPublish(role)).toBe(false)
    expect(canApprove(role)).toBe(false)
  })
})

describe("publishing and moderation", () => {
  const expected: Record<Role, boolean> = {
    owner: true,
    admin: true,
    editor: true,
    contributor: false,
  }

  it("lets editor and above publish", () => {
    for (const role of ROLES) expect(canPublish(role), role).toBe(expected[role])
  })

  it("lets editor and above approve submissions", () => {
    for (const role of ROLES) expect(canApprove(role), role).toBe(expected[role])
  })

  it("lets editor and above moderate reader questions", () => {
    for (const role of ROLES) expect(canModerateQuestions(role), role).toBe(expected[role])
  })

  it("lets editor and above bulk-edit and permanently delete", () => {
    for (const role of ROLES) {
      expect(canBulkEditPosts(role), role).toBe(expected[role])
      expect(canPermanentlyDeletePost(role), role).toBe(expected[role])
    }
  })
})

describe("post ownership — the contributor rule", () => {
  it("lets a contributor edit their own unpublished post", () => {
    expect(canEditPost("contributor", ALICE, { authorId: ALICE, isPublished: false })).toBe(true)
  })

  it("stops a contributor editing their own PUBLISHED post", () => {
    // Editing a live post is publishing: the change is visible the instant it
    // saves, with no review step in between.
    expect(canEditPost("contributor", ALICE, { authorId: ALICE, isPublished: true })).toBe(false)
  })

  it("stops a contributor editing someone else's post either way", () => {
    expect(canEditPost("contributor", ALICE, { authorId: BOB, isPublished: false })).toBe(false)
    expect(canEditPost("contributor", ALICE, { authorId: BOB, isPublished: true })).toBe(false)
  })

  it("lets editor and above edit anyone's post, published or not", () => {
    for (const role of ["editor", "admin", "owner"] as const) {
      expect(canEditPost(role, ALICE, { authorId: BOB, isPublished: true }), role).toBe(true)
    }
  })

  it("makes trashing follow editing exactly", () => {
    const cases = [
      { authorId: ALICE, isPublished: false },
      { authorId: ALICE, isPublished: true },
      { authorId: BOB, isPublished: false },
    ]
    for (const role of ROLES) {
      for (const post of cases) {
        expect(canTrashPost(role, ALICE, post)).toBe(canEditPost(role, ALICE, post))
      }
    }
  })

  it("lets a contributor submit their own post for review but not another's", () => {
    expect(canSubmitForReview("contributor", ALICE, { authorId: ALICE })).toBe(true)
    expect(canSubmitForReview("contributor", ALICE, { authorId: BOB })).toBe(false)
  })

  it("lets a contributor mint a preview link for their own post only", () => {
    expect(canCreatePreviewLink("contributor", ALICE, { authorId: ALICE })).toBe(true)
    expect(canCreatePreviewLink("contributor", ALICE, { authorId: BOB })).toBe(false)
  })
})

describe("administrative capabilities", () => {
  const adminAndUp: Record<Role, boolean> = {
    owner: true,
    admin: true,
    editor: false,
    contributor: false,
  }

  it("stops editors and contributors reaching settings or users", () => {
    for (const role of ROLES) {
      expect(canManageSettings(role), role).toBe(adminAndUp[role])
      expect(canManageUsers(role), role).toBe(adminAndUp[role])
    }
  })
})

describe("role changes — the escalation rules", () => {
  it("stops anything below admin changing roles at all", () => {
    for (const actor of ["editor", "contributor"] as const) {
      for (const target of ROLES) {
        expect(canChangeRole(actor, target), `${actor} -> ${target}`).toBe(false)
        expect(canAssignRole(actor, target), `${actor} -> ${target}`).toBe(false)
      }
    }
  })

  it("stops an admin touching an owner", () => {
    expect(canChangeRole("admin", "owner")).toBe(false)
    expect(canChangeRole("owner", "owner")).toBe(true)
  })

  it("stops an admin promoting anyone — including themselves — to owner", () => {
    // Without this, an admin promotes themselves to owner and then demotes the
    // real one: privilege escalation in two individually legal-looking steps.
    expect(canAssignRole("admin", "owner")).toBe(false)
    expect(canAssignRole("owner", "owner")).toBe(true)
  })

  it("lets an admin assign every non-owner role", () => {
    for (const target of ["admin", "editor", "contributor"] as const) {
      expect(canAssignRole("admin", target), target).toBe(true)
      expect(canChangeRole("admin", target), target).toBe(true)
    }
  })

  it("lets an owner be demoted only by themselves", () => {
    expect(canDemoteOwner(ALICE, ALICE)).toBe(true)
    expect(canDemoteOwner(ALICE, BOB)).toBe(false)
  })
})

describe("monotonicity of the role ladder", () => {
  it("never grants a lower role a capability a higher role lacks", () => {
    const ladder: Role[] = ["contributor", "editor", "admin", "owner"]
    const checks: [string, (role: Role) => boolean][] = [
      ["canPublish", canPublish],
      ["canApprove", canApprove],
      ["canModerateQuestions", canModerateQuestions],
      ["canBulkEditPosts", canBulkEditPosts],
      ["canPermanentlyDeletePost", canPermanentlyDeletePost],
      ["canManageSettings", canManageSettings],
      ["canManageUsers", canManageUsers],
      ["canEditOthersPublished", (r) => canEditPost(r, ALICE, { authorId: BOB, isPublished: true })],
    ]

    for (const [name, check] of checks) {
      for (let i = 0; i < ladder.length - 1; i++) {
        if (check(ladder[i])) {
          expect(check(ladder[i + 1]), `${name}: ${ladder[i]} yes but ${ladder[i + 1]} no`).toBe(true)
        }
      }
    }
  })
})
