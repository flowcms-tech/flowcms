import { eq } from "drizzle-orm"
import { db } from "./client"
import { blogPosts } from "@/db/tables"
import { canEditPost, resolveRole } from "@/Framework/Auth/permissions"

/**
 * The ownership gate for every route that edits a post *indirectly* — its FAQs,
 * its related-post overrides, a revision restore.
 *
 * Lives next to postLocks.ts rather than under Framework/Auth because it reads
 * the database, and Framework/Auth has one file (auth.config.ts) that must stay
 * DB-free for the proxy's sake. Keeping the DB-touching half out of that folder
 * entirely is cheaper than remembering which file is safe to import.
 *
 * The main PATCH/DELETE handlers do NOT use this: they have already loaded the
 * post row for other reasons, and a second read of the same row to answer the
 * same question would be pure ceremony.
 */
export async function checkPostEditAccess(
  postId: string,
  actor: { id: string; role?: unknown }
): Promise<
  // The post comes back on success so callers that need its title — the
  // activity log files FAQ and related-post edits against the post they belong
  // to — don't re-read the row this function has already loaded.
  | { ok: true; post: typeof blogPosts.$inferSelect }
  | { ok: false; status: 403 | 404; message: string }
> {
  const post = await db.query.blogPosts.findFirst({ where: eq(blogPosts.id, postId) })
  if (!post) return { ok: false, status: 404, message: "Not found" }

  if (!canEditPost(resolveRole(actor.role), actor.id, post)) {
    return { ok: false, status: 403, message: "You can only edit your own unpublished posts" }
  }

  return { ok: true, post }
}
