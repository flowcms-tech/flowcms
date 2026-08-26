import { NextResponse } from "next/server"

/**
 * Liveness: is this process running?
 *
 * Deliberately answers without touching the database, the settings row, or the
 * filesystem. A liveness probe that can fail for a dependency's reasons will
 * eventually restart a perfectly healthy process during a dependency blip,
 * which converts a brief outage of one component into a rolling outage of
 * everything. Readiness is where dependencies belong; see /api/ready.
 *
 * Public and unauthenticated, so it says nothing except that it is running.
 */
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ status: "ok" })
}
