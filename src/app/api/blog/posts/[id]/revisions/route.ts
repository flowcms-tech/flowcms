import { NextRequest, NextResponse } from "next/server"
import { desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPostRevisions, users } from "@/db/tables"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { checkPostEditAccess } from "@/db/postAccess"

/** Edit history for a post, newest first. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { id } = await params

  // Revision history is the full body of every past draft of this post. The
  // route floor admits a contributor because they need their own history; this
  // is what stops them reading somebody else's. Editors and above pass
  // unconditionally, so nothing changes for them.
  const access = await checkPostEditAccess(id, gate.session.user)
  if (!access.ok) {
    return NextResponse.json({ message: access.message }, { status: access.status })
  }

  const rows = await db.query.blogPostRevisions.findMany({
    where: eq(blogPostRevisions.postId, id),
    orderBy: desc(blogPostRevisions.createdAt),
  })

  const editorIds = Array.from(new Set(rows.map((row) => row.editorId)))
  const editors = editorIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, editorIds) })
    : []
  const editorById = new Map(editors.map((editor) => [editor.id, editor]))

  const data = rows.map((row) => ({
    id: row.id,
    postId: row.postId,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content,
    editor: { id: row.editorId, name: editorById.get(row.editorId)?.name ?? "" },
    createdAt: row.createdAt,
  }))

  return NextResponse.json({ data, message: "OK" })
}
