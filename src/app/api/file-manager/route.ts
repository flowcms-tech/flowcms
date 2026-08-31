import { NextRequest, NextResponse } from "next/server"
import { StorageService } from "@/Framework/Storage/StorageService"
import { mediaPath } from "@/Framework/Storage/mediaUrl"
import { isAllowedFileType, getFileCategory } from "@/Framework/Functions/FileValidation"
import {
  MAX_UPLOAD_BYTES,
  UnsafeObjectKeyError,
  buildObjectKey,
} from "@/Framework/Storage/objectKey"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

function serializeObject(obj: { key: string; size: number; lastModified: Date }) {
  const name = obj.key.split("/").pop() || obj.key
  return {
    id: obj.key,
    name,
    size: obj.size,
    lastModified: obj.lastModified.toISOString(),
  }
}

/**
 * Adds the URL the grid renders as a thumbnail.
 *
 * Was a presigned URL pointing at the object store, which the browser fetched
 * directly. On the bundled-Garage deployment that URL names `http://garage:3900`
 * — a hostname only reachable from inside the Docker network — so every
 * thumbnail was already broken there. It is now an application route, which
 * works on any backend and leaks no bucket, endpoint or key.
 *
 * SYNCHRONOUS NOW. Building a URL needs no round trip, so listing a folder of a
 * hundred images no longer issues a hundred signing operations.
 */
function serializeObjectWithThumbnail(obj: { key: string; size: number; lastModified: Date }) {
  const base = serializeObject(obj)
  if (getFileCategory(base.name) !== "image") {
    return base
  }
  return { ...base, thumbnailUrl: mediaPath(obj.key) }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const prefix = searchParams.get("prefix") ?? ""

  const { directories, files } = await StorageService.listDirectory(prefix)
  const serializedFiles = files.map(serializeObjectWithThumbnail)

  return NextResponse.json({
    data: { directories, files: serializedFiles },
    message: "OK",
  })
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const formData = await request.formData()
  const file = formData.get("file")
  const prefix = formData.get("prefix")
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "No file provided" }, { status: 422 })
  }

  // Size is checked BEFORE the body is read into memory. `file.arrayBuffer()`
  // materialises the whole upload in the process, so checking afterwards would
  // mean the damage is already done — one large request could exhaust the
  // server regardless of what the check then decided.
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        message: [
          `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ` +
            `${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        ],
      },
      { status: 422 }
    )
  }

  if (!isAllowedFileType(file.name)) {
    return NextResponse.json({ message: "This file type is not allowed" }, { status: 422 })
  }

  // The key used to be `prefix + file.name` — both attacker-influenced strings,
  // concatenated raw. `file.name` comes from the multipart body, so a client
  // that is not a browser can put anything in it, including `../`.
  let key: string
  try {
    key = buildObjectKey(typeof prefix === "string" ? prefix : "", file.name)
  } catch (error) {
    const message =
      error instanceof UnsafeObjectKeyError ? error.message : "That destination is not valid."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }

  // Re-checked on the SANITISED key, not just the submitted name: sanitisation
  // can change the trailing characters, and the allowlist has to apply to what
  // is actually written.
  if (!isAllowedFileType(key)) {
    return NextResponse.json({ message: "This file type is not allowed" }, { status: 422 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  // `file.size` is a claim from the multipart parser; this is the measurement.
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ message: ["That file is too large."] }, { status: 422 })
  }

  await StorageService.uploadObject(key, buffer, file.type || undefined)

  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "file",
    entityId: key,
    entityLabel: key,
    summary: `Uploaded ${(buffer.length / 1024).toFixed(0)} KB`,
  })

  return NextResponse.json({
    data: serializeObjectWithThumbnail({ key, size: buffer.length, lastModified: new Date() }),
    message: "File uploaded",
  })
}
