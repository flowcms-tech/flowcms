import { NextRequest, NextResponse } from "next/server"
import { getKeyDetail, deleteAppKey } from "@/Framework/Redis/RedisMonitorService"
import { CACHE_PREFIX } from "@/Framework/Redis/CacheService"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

// A query param, not a dynamic route segment (/api/redis/key/[...key]):
// Redis keys can contain slashes and colons, which would otherwise collide
// with Next's own route-segment parsing. ?key= just needs URL-encoding,
// which every client already does for query strings.

/**
 * The namespace restriction that DELETE always had, applied to reads too.
 *
 * Redis is frequently shared between applications on one box, and this endpoint
 * returned the value of any key on the instance to any signed-in user — session
 * stores, queues, another app's cached PII. It was a general-purpose Redis
 * browser wearing a CMS badge. The cache inspector only ever needs this app's
 * own keys, so it only gets them.
 */
function outsideCacheNamespace(key: string): NextResponse | null {
  if (key.startsWith(CACHE_PREFIX)) return null
  return NextResponse.json(
    { message: [`Only keys under "${CACHE_PREFIX}" can be inspected here`] },
    { status: 422 }
  )
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const key = new URL(request.url).searchParams.get("key")
  if (!key) {
    return NextResponse.json({ message: ["A key is required"] }, { status: 422 })
  }

  const refusal = outsideCacheNamespace(key)
  if (refusal) return refusal

  const detail = await getKeyDetail(key)
  if (!detail) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ data: detail, message: "OK" })
}

/** Refuses to remove anything outside this app's own cache prefix — see
 *  deleteAppKey's comment. */
export async function DELETE(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const key = new URL(request.url).searchParams.get("key")
  if (!key) {
    return NextResponse.json({ message: ["A key is required"] }, { status: 422 })
  }

  const refusal = outsideCacheNamespace(key)
  if (refusal) return refusal

  // Idempotent either way: already-gone and just-deleted both end with the
  // key not existing, which is the caller's actual goal.
  await deleteAppKey(key)
  return NextResponse.json({ data: null, message: "Key deleted" })
}
