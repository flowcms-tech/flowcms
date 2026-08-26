import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { db } from "@/db/client"
import { redirects } from "@/db/tables"
import { buildRedirectCsv } from "@/Modules/Redirects/Values/redirectImport"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * CSV export of the whole redirect table.
 *
 * Returned as an attachment rather than JSON because the only thing anyone
 * does with this is open it in a spreadsheet, edit it, and import it back —
 * the column order is the importer's, so a round trip needs no editing.
 *
 * Not cached: an export is taken precisely when someone is about to change
 * something, and a 60-second stale copy would be the wrong starting point.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const rows = await db.query.redirects.findMany({ orderBy: desc(redirects.createdAt) })
  const csv = buildRedirectCsv(rows)

  const stamp = new Date().toISOString().slice(0, 10)

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="redirects-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
