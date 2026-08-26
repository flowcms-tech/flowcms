import { NextRequest, NextResponse } from "next/server"
import { StorageService } from "@/Framework/Storage/StorageService"
import { computeTransferPrefix, validateTransferDestination } from "../transferValidation"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const body = await request.json()
  const sourcePrefix = typeof body.prefix === "string" ? body.prefix : ""
  const destinationPrefix = typeof body.destination === "string" ? body.destination : ""

  const newPrefix = computeTransferPrefix(sourcePrefix, destinationPrefix)
  if (!sourcePrefix || !newPrefix) {
    return NextResponse.json({ message: "Invalid source directory" }, { status: 422 })
  }

  const error = await validateTransferDestination(sourcePrefix, destinationPrefix, newPrefix)
  if (error) {
    return NextResponse.json({ message: error }, { status: 422 })
  }

  if (newPrefix === sourcePrefix) {
    return NextResponse.json({ message: "Cannot copy a directory into its own location" }, { status: 422 })
  }

  await StorageService.copyPrefix(sourcePrefix, newPrefix)

  await recordActivity({
    actor: session.user,
    action: "copied",
    entityType: "folder",
    entityId: newPrefix,
    entityLabel: newPrefix,
    summary: `Copied from ${sourcePrefix}, with everything inside it`,
  })

  return NextResponse.json({ data: { prefix: newPrefix }, message: "Directory copied" })
}
