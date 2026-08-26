import { NextRequest, NextResponse } from "next/server"
import { scanKeyspace } from "@/Framework/Redis/RedisMonitorService"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/** Read-only browse of THIS APP'S keyspace. `scanKeyspace` confines the scan to
 *  the FlowCMS cache prefix, so the caller's pattern narrows within it and
 *  cannot reach a neighbouring application's keys on a shared instance. */
export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const pattern = searchParams.get("pattern")?.trim() || "*"
  const cursor = searchParams.get("cursor") || "0"
  const count = Number(searchParams.get("count") ?? 50)

  const page = await scanKeyspace(pattern, cursor, Number.isFinite(count) ? count : 50)
  return NextResponse.json({ data: page, message: "OK" })
}
