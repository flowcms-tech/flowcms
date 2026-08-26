import { NextRequest, NextResponse } from "next/server"
import { StorageService } from "@/Framework/Storage/StorageService"
import { isAllowedFileType } from "@/Framework/Functions/FileValidation"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

export async function PATCH(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const body = await request.json()
  const key = typeof body.key === "string" ? body.key : ""
  const name = typeof body.name === "string" ? body.name.trim() : ""

  if (!key || !name || name.includes("/")) {
    return NextResponse.json({ message: "Invalid rename request" }, { status: 422 })
  }

  if (!isAllowedFileType(name)) {
    return NextResponse.json({ message: "This file type is not allowed" }, { status: 422 })
  }

  const parentPrefix = key.slice(0, key.lastIndexOf("/") + 1)
  const newKey = `${parentPrefix}${name}`

  if (newKey === key) {
    return NextResponse.json({ data: { key }, message: "No changes" })
  }

  const existing = await StorageService.listDirectory(parentPrefix)
  if (existing.files.some((f) => f.key === newKey)) {
    return NextResponse.json({ message: "A file with that name already exists" }, { status: 422 })
  }

  await StorageService.renameObject(key, newKey)

  // Renaming an object in S3 breaks every stored key that pointed at it —
  // post featured images, editor <img> sources, author avatars. Nothing else
  // in the app records that this happened.
  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "file",
    entityId: newKey,
    entityLabel: newKey,
    summary: `Renamed from ${key}`,
  })

  return NextResponse.json({ data: { key: newKey }, message: "File renamed" })
}

export async function DELETE(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const body = await request.json()
  const key = typeof body.key === "string" ? body.key : ""

  if (!key) {
    return NextResponse.json({ message: "Invalid file" }, { status: 422 })
  }

  await StorageService.deleteObject(key)

  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "file",
    entityId: key,
    entityLabel: key,
  })

  return NextResponse.json({ data: null, message: "File deleted" })
}
