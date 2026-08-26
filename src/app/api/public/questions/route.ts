import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { and, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPostQuestions, blogPosts } from "@/db/tables"
import { verifyCaptchaToken } from "@/Framework/Captcha/captcha"
import { CacheService } from "@/Framework/Redis/CacheService"
import { createPublicQuestionSchema } from "@/Modules/Blog/Questions/Values/Validations"

/**
 * PUBLIC endpoint — no `auth()` call, by design. An anonymous reader asking a
 * question is the entire feature.
 *
 * That makes it internet-facing, so it carries three independent controls
 * rather than one: the existing HMAC-cookie captcha (the same flow the login
 * screen uses), a per-IP rate limit through Redis, and a honeypot field. None of
 * them is sufficient alone — a captcha stops scripted floods but not a cheap
 * human farm, a rate limit stops volume but not a single well-crafted spam, and
 * a honeypot stops naive bots and nothing else.
 *
 * The real backstop is that nothing here becomes public. A row lands as
 * `pending` with no answer, and the render path only ever reads answered,
 * published rows. Spam that gets through is spam an admin deletes from a queue,
 * not spam on the site.
 */

const RATE_LIMIT_WINDOW_SECONDS = 3600
const RATE_LIMIT_MAX = 5
/** Per post, so one contentious article cannot be used to flood the queue. */
const PER_POST_LIMIT_MAX = 3

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  return request.headers.get("x-real-ip") ?? "unknown"
}

/**
 * Fixed-window counter on the shared Redis client.
 *
 * Redis rather than a per-process in-memory map, because such a map is
 * written for a single process and this route now has one available that
 * survives a restart. It still fails OPEN: `CacheService` degrades to a no-op
 * when Redis is down, and refusing every reader's question because a cache is
 * unavailable would be a worse outcome than letting a few extras through to a
 * moderation queue.
 */
async function isRateLimited(key: string, max: number): Promise<boolean> {
  const cacheKey = `questions:ratelimit:${key}`
  const current = (await CacheService.getJson<number>(cacheKey)) ?? 0
  if (current >= max) return true
  await CacheService.setJson(cacheKey, current + 1, RATE_LIMIT_WINDOW_SECONDS)
  return false
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: ["Invalid request body"] }, { status: 422 })
  }

  const parsed = createPublicQuestionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  // Honeypot tripped: return the ordinary success shape and drop it, so a bot
  // gets no signal that it was caught.
  if (parsed.data.website) {
    return NextResponse.json({ data: null, message: "Thanks — we'll take a look at your question." })
  }

  const ip = clientKey(request)
  if (
    (await isRateLimited(ip, RATE_LIMIT_MAX)) ||
    (await isRateLimited(`${ip}:${parsed.data.postId}`, PER_POST_LIMIT_MAX))
  ) {
    return NextResponse.json(
      { message: "You've sent us a few questions already. Please give us a chance to answer them." },
      { status: 429 }
    )
  }

  // The captcha cookie is consumed whatever the outcome, so a code can never be
  // replayed — the same single-use rule the login server action applies.
  const cookieStore = await cookies()
  const captchaToken = cookieStore.get("captcha_token")?.value
  const captchaOk = verifyCaptchaToken(captchaToken, parsed.data.captchaCode)
  cookieStore.delete("captcha_token")

  if (!captchaOk) {
    return NextResponse.json(
      { message: ["That security code didn't match. Please try the new one."] },
      { status: 422 }
    )
  }

  // Questions attach only to posts a reader can actually be looking at. A
  // draft or trashed id in the payload is either a stale tab or someone
  // probing, and neither should create a row.
  const post = await db.query.blogPosts.findFirst({
    where: and(eq(blogPosts.id, parsed.data.postId), eq(blogPosts.isPublished, true), isNull(blogPosts.deletedAt)),
  })
  if (!post) {
    return NextResponse.json({ message: ["We couldn't find that article"] }, { status: 422 })
  }

  // A cap per post, counted across everyone. Without it a single article can
  // accumulate an unbounded moderation backlog that nobody will ever clear.
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(blogPostQuestions)
    .where(and(eq(blogPostQuestions.postId, post.id), eq(blogPostQuestions.status, "pending")))
  if (Number(total) >= 100) {
    return NextResponse.json(
      { message: "We have a lot of questions waiting on this article. Please call us instead." },
      { status: 429 }
    )
  }

  await db.insert(blogPostQuestions).values({
    postId: post.id,
    askerName: parsed.data.askerName?.trim() || null,
    question: parsed.data.question.trim(),
    // status defaults to "pending" and answer stays null. Nothing about this
    // insert can produce something publicly visible.
  })

  // Nothing about the stored row goes back — a public endpoint should not echo
  // what it just wrote, and there is no id here worth handing to the caller.
  return NextResponse.json({
    data: null,
    message: "Thanks — we'll take a look at your question.",
  })
}
