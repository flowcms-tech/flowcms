import { NextRequest, NextResponse } from "next/server"
import { recordNotFound } from "@/db/notFoundLogging"

/**
 * Fire-and-forget 404 reporting from the client not-found page.
 *
 * Unauthenticated by necessity — the visitors who hit a broken link are not
 * logged in. That makes the body hostile input, so nothing from it is trusted:
 * the path is normalised and ignore-listed before it can reach the database,
 * and the response is always 204 regardless of what happened. A caller learns
 * nothing about whether a path was recorded, which removes any reason to
 * probe this endpoint.
 *
 * Every real guard (scanner filter, rate limit, table cap) lives in
 * src/db/notFoundLogging.ts so the server-rendered not-found branches share
 * exactly the same behaviour.
 */

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const noContent = new NextResponse(null, { status: 204 })

  try {
    const body = (await request.json()) as { path?: unknown; referrer?: unknown }
    if (typeof body?.path !== "string") return noContent

    const referrer = typeof body.referrer === "string" ? body.referrer : null
    await recordNotFound(body.path, referrer)
  } catch {
    // Malformed JSON is a scanner, not a broken link.
  }

  return noContent
}
