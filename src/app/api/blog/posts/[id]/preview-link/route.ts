import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/client"
import { blogPosts } from "@/db/tables"
import { canCreatePreviewLink, resolveRole } from "@/Framework/Auth/permissions"
import {
  PREVIEW_EXPIRY_OPTIONS,
  createPreviewToken,
  previewTokenExpiresAt,
} from "@/Framework/Auth/previewToken"
import { getBaseUrl } from "@/Framework/Settings/SettingsService"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

const bodySchema = z.object({
  expiresIn: z.enum(Object.keys(PREVIEW_EXPIRY_OPTIONS) as [string, ...string[]], {
    message: "Choose 24h, 7d, or 30d",
  }),
})

/**
 * Mints a shareable preview URL for a draft.
 *
 * The admin preview route needs a session, so
 * a draft cannot be shown to a client who does not have one. This returns a
 * signed, expiring link to the *public* URL instead, which is the point: the
 * client sees the page as it will actually look, not an admin rendering of it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const post = await db.query.blogPosts.findFirst({ where: eq(blogPosts.id, id) })
  if (!post) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  // A preview link hands unpublished content to anyone holding the URL, so it
  // is minted by the people who could have published it anyway — plus the
  // author of the draft, who is the person most likely to need it.
  if (!canCreatePreviewLink(resolveRole(session.user.role), session.user.id, post)) {
    return NextResponse.json(
      { message: "You can only share previews of your own posts" },
      { status: 403 }
    )
  }

  const token = createPreviewToken(
    id,
    parsed.data.expiresIn as keyof typeof PREVIEW_EXPIRY_OPTIONS
  )

  // Fails closed, and says so plainly. A silent fallback that produced a
  // working link without a configured secret would be the worst possible
  // outcome — a shareable URL that every forged token also opens.
  if (!token) {
    return NextResponse.json(
      {
        message: [
          "Preview links are turned off because PREVIEW_SECRET isn't set on the server. Set it and restart to enable them.",
        ],
      },
      { status: 422 }
    )
  }

  const base = await getBaseUrl()
  const url = `${base}/blog/${post.slug}?preview=${token}`

  // The token itself is never logged — it IS the credential, and an audit trail
  // that stores working preview links defeats their expiry. That a link was
  // minted, by whom, and for how long is the part worth recording: tokens are
  // HMACs with no rows to revoke, so this is the only trace one ever leaves.
  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "post",
    entityId: post.id,
    entityLabel: post.title,
    summary: `Created a shareable preview link, valid for ${parsed.data.expiresIn}`,
  })

  return NextResponse.json({
    data: {
      url,
      expiresAt: previewTokenExpiresAt(token),
      // Surfaced so the UI never has to imply per-link revocation it cannot
      // deliver — there is no token table, so this is the only revocation.
      revocable: false,
    },
    message: "Preview link created",
  })
}
