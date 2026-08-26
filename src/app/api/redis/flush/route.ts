import { NextRequest, NextResponse } from "next/server"
import { flushAppCache } from "@/Framework/Redis/RedisMonitorService"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/** Clears this app's cache namespace — never FLUSHALL/FLUSHDB. A debug
 *  action: every cleared key is either a list/detail cache that repopulates
 *  on the next read, or a stale one that was going to expire anyway. */
export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const deleted = await flushAppCache()
  return NextResponse.json({ data: { deleted }, message: `Cleared ${deleted} cached key${deleted === 1 ? "" : "s"}` })
}
