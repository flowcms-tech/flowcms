import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPostFaqs } from "@/db/tables"
import { checkPostEditAccess } from "@/db/postAccess"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params

  const access = await checkPostEditAccess(id, session.user)
  if (!access.ok) {
    return NextResponse.json({ message: access.message }, { status: access.status })
  }

  const body = await request.json()
  const orderedIds = Array.isArray(body?.orderedIds) ? body.orderedIds.filter((v: unknown) => typeof v === "string") : null
  if (!orderedIds) {
    return NextResponse.json({ message: "orderedIds must be an array of FAQ ids" }, { status: 422 })
  }

  const existing = await db.query.blogPostFaqs.findMany({ where: eq(blogPostFaqs.postId, id) })
  const existingIds = new Set(existing.map((row) => row.id))
  if (orderedIds.length !== existing.length || !orderedIds.every((faqId: string) => existingIds.has(faqId))) {
    return NextResponse.json({ message: "orderedIds must match this post's FAQs exactly" }, { status: 422 })
  }

  await db.transaction(async (tx) => {
    await Promise.all(
      orderedIds.map((faqId: string, index: number) =>
        tx.update(blogPostFaqs).set({ priority: index, updatedAt: new Date() }).where(eq(blogPostFaqs.id, faqId))
      )
    )
  })

  return NextResponse.json({ data: null, message: "FAQ order updated" })
}
