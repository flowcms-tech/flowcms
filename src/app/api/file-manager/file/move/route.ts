import { NextRequest, NextResponse } from "next/server"
import { StorageService } from "@/Framework/Storage/StorageService"
import { computeFileTransferKey, validateFileDestination } from "../fileTransferValidation"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const body = await request.json()
  const sourceKey = typeof body.key === "string" ? body.key : ""
  const destinationPrefix = typeof body.destination === "string" ? body.destination : ""

  const newKey = computeFileTransferKey(sourceKey, destinationPrefix)
  if (!sourceKey || !newKey) {
    return NextResponse.json({ message: "Invalid source file" }, { status: 422 })
  }

  const error = await validateFileDestination(sourceKey, destinationPrefix, newKey)
  if (error) {
    return NextResponse.json({ message: error }, { status: 422 })
  }

  if (newKey === sourceKey) {
    return NextResponse.json({ data: { key: sourceKey }, message: "No changes" })
  }

  await StorageService.renameObject(sourceKey, newKey)

  await recordActivity({
    actor: session.user,
    action: "moved",
    entityType: "file",
    entityId: newKey,
    entityLabel: newKey,
    summary: `Moved from ${sourceKey}`,
  })

  return NextResponse.json({ data: { key: newKey }, message: "File moved" })
}
