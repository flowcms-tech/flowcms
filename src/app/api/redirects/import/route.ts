import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db/client"
import { upsertRedirectWithFlattening, findLiveConflict } from "@/db/redirectMaintenance"
import { markNotFoundResolved } from "@/db/notFoundLogging"
import { CacheService } from "@/Framework/Redis/CacheService"
import { importRedirectsSchema } from "@/Modules/Redirects/Values/Validations"
import {
  parseRedirectCsv,
  type RedirectImportRejection,
} from "@/Modules/Redirects/Values/redirectImport"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * CSV import, dry-run-then-confirm.
 *
 * Order matters and is not arbitrary:
 *
 *  1. Pure batch validation (`parseRedirectCsv`) — malformed rows,
 *     self-redirects, duplicate fromPaths, and cycles contained inside the
 *     file, which is the one class of problem the row-by-row writer cannot
 *     see. See that file for what goes wrong without this pass.
 *  2. Live-content conflicts, which need the database — the real content
 *     always wins over the redirect table, so a redirect for a path a
 *     published post still occupies would look imported and do nothing.
 *  3. Only then, and only when `confirm` is true, the writes — one at a time
 *     through `upsertRedirectWithFlattening` so each still gets the chain
 *     flattening, loop deletion, and cache invalidation every other redirect
 *     write gets. Nothing about the import path is allowed to bypass that.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const parsed = importRedirectsSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const { csv, confirm } = parsed.data
  const report = parseRedirectCsv(csv)
  const rejected: RedirectImportRejection[] = [...report.rejected]

  const writable: typeof report.valid = []
  for (const row of report.valid) {
    const conflict = await findLiveConflict(row.fromPath)
    if (conflict) {
      // Deliberately never offers the create form's "also trash the post"
      // escape hatch: trashing content as a side effect of a bulk paste is
      // not something anyone should be able to do without seeing it happen.
      rejected.push({
        lineNumber: row.lineNumber,
        fromPath: row.fromPath,
        toPath: row.toPath,
        reason: `"${conflict.title}" is still a live ${conflict.type} at that path — this redirect would never fire.`,
      })
      continue
    }
    writable.push(row)
  }

  rejected.sort((a, b) => a.lineNumber - b.lineNumber)

  const summary = {
    dryRun: !confirm,
    totalRows: report.totalRows,
    importable: writable.length,
    rejectedCount: rejected.length,
    rejected,
  }

  if (!confirm) {
    return NextResponse.json({
      data: { ...summary, imported: 0 },
      message: `Dry run: ${writable.length} of ${report.totalRows} row(s) would be imported.`,
    })
  }

  if (writable.length > 0) {
    await db.transaction(async (tx) => {
      for (const row of writable) {
        await upsertRedirectWithFlattening(tx, row.fromPath, row.toPath, false, row.statusCode)
      }
    })

    // Outside the transaction: a 404 row is bookkeeping, and failing the whole
    // import because a log row wouldn't update would be the wrong trade.
    for (const row of writable) await markNotFoundResolved(row.fromPath)
    await CacheService.delPattern("not-found-log:*")

    // One entry for the import, not one per row — same reasoning as the bulk
    // post edit. Dry runs write nothing and are not logged: nothing happened.
    await recordActivity({
      actor: session.user,
      action: "created",
      entityType: "redirect",
      entityId: null,
      entityLabel: `${writable.length} redirect${writable.length === 1 ? "" : "s"}`,
      summary: `CSV import: ${writable.length} written, ${rejected.length} rejected`,
      metadata: { imported: writable.map((row) => `${row.fromPath} → ${row.toPath}`) },
    })
  }

  return NextResponse.json({
    data: { ...summary, imported: writable.length },
    message: `Imported ${writable.length} redirect(s), rejected ${rejected.length}.`,
  })
}
