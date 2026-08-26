/**
 * Editorial roles — the single source of truth for "who may do what".
 *
 * Dependency-free on purpose. This module is imported by route handlers (Node,
 * with the DB client in scope) AND by client components that hide buttons, so
 * it must not pull in `next/*`, the database, or anything else that would drag
 * a server bundle into the browser or vice versa. Everything here is a pure
 * function over plain data.
 *
 * The UI reading these is polish. The routes reading them are the enforcement —
 * a hidden button is not a permission check, and every rule below is applied
 * server-side before any write.
 */

export const ROLES = ["owner", "admin", "editor", "contributor"] as const

export type Role = (typeof ROLES)[number]

/** Ordered most- to least-privileged, for "at least this role" comparisons. */
const ROLE_RANK: Record<Role, number> = {
  owner: 3,
  admin: 2,
  editor: 1,
  contributor: 0,
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  contributor: "Contributor",
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Everything, including site settings, integrations, and role changes.",
  admin: "Everything except demoting an owner or granting the owner role.",
  editor: "Full blog CRUD, publishing, and approving or rejecting submissions.",
  contributor: "Creates and edits their own drafts, and submits them for review. Never publishes.",
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
}

/** The role granted when nothing better is known. Least privilege, by name. */
export const FALLBACK_ROLE: Role = "contributor"

/**
 * Coerces whatever arrived on a session or in a payload to a real role.
 *
 * FAILS CLOSED.
 *
 * This used to fall back to "admin", matching the column default. That was
 * defensible exactly once: during the migration that introduced roles, every
 * pre-existing account had been created when there were no roles and had full
 * rights, so a restrictive default would have stripped permissions from live
 * users mid-session.
 *
 * As a permanent default in software other people install, it is the wrong way
 * round — any missing, unrecognised, or corrupted role value silently becomes
 * an administrator, and a fresh install has no legacy accounts to protect.
 *
 * The migration concern does not survive the change either, because the value
 * being resolved is refreshed from the database: `auth.ts`'s `jwt` callback
 * re-reads the user at most 60 seconds after any request and overwrites
 * `token.role`. So a session carrying no role is under-privileged for at most
 * that one interval, and then correct — a self-healing inconvenience rather
 * than a standing grant of administrative access.
 *
 * The users table's column default moves to "contributor" in the same change,
 * because the two have to agree: if they disagreed, a token refresh would
 * change what a user can do.
 */
export function resolveRole(value: unknown): Role {
  return isRole(value) ? value : FALLBACK_ROLE
}

function atLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum]
}

// -- Post capabilities --------------------------------------------------------

/** The subset of a post row any of these checks needs. Keeps the module free of
 *  a Drizzle import and lets the client pass a serialized post. */
export interface PostOwnership {
  /** The admin account that created the post (`blog_post.authorId`). */
  authorId: string
  isPublished?: boolean
}

/** Publishing, unpublishing, scheduling — anything that puts a URL on the
 *  public site. A contributor never does this; that is the whole point of the
 *  role. */
export function canPublish(role: Role): boolean {
  return atLeast(role, "editor")
}

/**
 * A contributor may edit only their own unpublished work.
 *
 * The "unpublished" half matters as much as the "own" half: once a post is
 * live, editing it is publishing — the change is visible the moment it saves,
 * with no review step in between.
 */
export function canEditPost(role: Role, userId: string, post: PostOwnership): boolean {
  if (atLeast(role, "editor")) return true
  return post.authorId === userId && !post.isPublished
}

/** Trashing follows editing: a contributor can bin their own draft, but not a
 *  live post and not somebody else's. */
export function canTrashPost(role: Role, userId: string, post: PostOwnership): boolean {
  return canEditPost(role, userId, post)
}

/** Permanent deletion cascades to FAQs, revisions, questions, and taxonomy
 *  links, and nothing brings any of it back. Never a contributor. */
export function canPermanentlyDeletePost(role: Role): boolean {
  return atLeast(role, "editor")
}

/**
 * Bulk SEO editing. Editor and up only, whoever wrote the posts.
 *
 * The per-post ownership rule cannot help here: a bulk call names a list of
 * ids, most of which will not belong to the caller, and applying it to "just
 * the ones you own" would silently do a fraction of what the screen said it
 * would.
 */
export function canBulkEditPosts(role: Role): boolean {
  return atLeast(role, "editor")
}

/** Approving or rejecting a submission. */
export function canApprove(role: Role): boolean {
  return atLeast(role, "editor")
}

/**
 * Submitting for review. A contributor submits their own drafts; higher roles
 * can submit anything, which is occasionally useful (an editor wanting a second
 * pair of eyes) and never harmful — `pending` blocks nothing on its own.
 */
export function canSubmitForReview(role: Role, userId: string, post: PostOwnership): boolean {
  if (atLeast(role, "editor")) return true
  return post.authorId === userId
}

/** Reader questions are moderation, which is an editorial job. */
export function canModerateQuestions(role: Role): boolean {
  return atLeast(role, "editor")
}

/** Preview links expose unpublished content to anyone holding the URL, so they
 *  are minted by the same people who could publish it anyway. */
export function canCreatePreviewLink(role: Role, userId: string, post: PostOwnership): boolean {
  if (atLeast(role, "editor")) return true
  return post.authorId === userId
}

// -- Administrative capabilities ---------------------------------------------

/** Site settings and third-party integrations. Both hold credentials and both
 *  change how the public site behaves, so editors are out. */
export function canManageSettings(role: Role): boolean {
  return atLeast(role, "admin")
}

/** Creating, editing, deactivating, and deleting staff accounts. */
export function canManageUsers(role: Role): boolean {
  return atLeast(role, "admin")
}

/**
 * Appearance: which theme the public site renders.
 *
 * Admin, matching `canManageSettings`, and for the same reason — activating a
 * theme changes every public page at once. An editor's authority is over
 * content; this is over how the whole site looks to every visitor, and it takes
 * effect the moment the button is pressed.
 */
export function canManageAppearance(role: Role): boolean {
  return atLeast(role, "admin")
}

/**
 * Navigation menus: which links appear in a theme's menu slots.
 *
 * EDITOR, deliberately one step below `canManageAppearance`, and the two must
 * not be collapsed into one predicate for tidiness. A menu is a set of links to
 * content, and the people who write the content are the people who decide how
 * a reader reaches it — the same reasoning that puts publishing and question
 * moderation at editor. Activating a theme is a different act: it replaces the
 * markup of every public page at once and cannot be undone by editing a row.
 *
 * The floor is real either way: a contributor can propose content but cannot
 * put a link to it in the site's main navigation.
 */
export function canManageMenus(role: Role): boolean {
  return atLeast(role, "editor")
}

/**
 * Whether `actorRole` may change the role of a user who currently holds
 * `targetRole`.
 *
 * The asymmetry is deliberate: an admin can do everything an owner can except
 * touch an owner. Nothing below admin can change roles at all.
 */
export function canChangeRole(actorRole: Role, targetRole: Role): boolean {
  if (!canManageUsers(actorRole)) return false
  if (targetRole === "owner") return actorRole === "owner"
  return true
}

/**
 * Whether `actorRole` may *grant* `nextRole`.
 *
 * Only an owner can mint another owner. Otherwise an admin could promote
 * themselves to owner and then demote the real one — privilege escalation via
 * two legal-looking steps.
 */
export function canAssignRole(actorRole: Role, nextRole: Role): boolean {
  if (!canManageUsers(actorRole)) return false
  if (nextRole === "owner") return actorRole === "owner"
  return true
}

/**
 * An owner can only be demoted by itself.
 *
 * A panel that can lock out its last owner is a support call waiting to happen,
 * and "the other owner demoted me" is the same outcome by a different route.
 * The last-owner-standing check is separate and lives in the route, because it
 * needs a count from the database that a pure function cannot have.
 */
export function canDemoteOwner(actorId: string, targetId: string): boolean {
  return actorId === targetId
}
