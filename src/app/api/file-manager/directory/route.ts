import { NextRequest, NextResponse } from "next/server"
import { StorageService } from "@/Framework/Storage/StorageService"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const body = await request.json()
  const parentPrefix = typeof body.prefix === "string" ? body.prefix : ""
  const name = typeof body.name === "string" ? body.name.trim() : ""

  if (!name || name.includes("/")) {
    return NextResponse.json({ message: "Invalid directory name" }, { status: 422 })
  }

  const newPrefix = `${parentPrefix}${name}/`
  await StorageService.createDirectory(newPrefix)

  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "folder",
    entityId: newPrefix,
    entityLabel: newPrefix,
  })

  return NextResponse.json({ data: { prefix: newPrefix }, message: "Directory created" })
}

export async function PATCH(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const body = await request.json()
  const oldPrefix = typeof body.prefix === "string" ? body.prefix : ""
  const name = typeof body.name === "string" ? body.name.trim() : ""

  if (!oldPrefix || !name || name.includes("/")) {
    return NextResponse.json({ message: "Invalid rename request" }, { status: 422 })
  }

  const segments = oldPrefix.split("/")
  const parentSegments = segments.slice(0, -2)
  const parent = parentSegments.length > 0 ? `${parentSegments.join("/")}/` : ""
  const newPrefix = `${parent}${name}/`

  if (newPrefix === oldPrefix) {
    return NextResponse.json({ data: { prefix: oldPrefix }, message: "No changes" })
  }

  const existing = await StorageService.listDirectory(parent)
  if (existing.directories.includes(newPrefix)) {
    return NextResponse.json({ message: "A directory with that name already exists" }, { status: 422 })
  }

  await StorageService.renamePrefix(oldPrefix, newPrefix)

  // A prefix rename moves every object underneath it, so this one entry stands
  // for an unbounded number of broken image keys.
  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "folder",
    entityId: newPrefix,
    entityLabel: newPrefix,
    summary: `Renamed from ${oldPrefix}, moving everything inside it`,
  })

  return NextResponse.json({ data: { prefix: newPrefix }, message: "Directory renamed" })
}

export async function DELETE(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const body = await request.json()
  const prefix = typeof body.prefix === "string" ? body.prefix : ""

  if (!prefix) {
    return NextResponse.json({ message: "Invalid directory" }, { status: 422 })
  }

  await StorageService.deletePrefix(prefix)

  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "folder",
    entityId: prefix,
    entityLabel: prefix,
    summary: "Deleted the folder and everything inside it",
  })

  return NextResponse.json({ data: null, message: "Directory deleted" })
}
