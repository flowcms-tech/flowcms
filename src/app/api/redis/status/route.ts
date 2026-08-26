import { NextRequest, NextResponse } from "next/server"
import { getStatus } from "@/Framework/Redis/RedisMonitorService"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const status = await getStatus()
  return NextResponse.json({ data: status, message: "OK" })
}
