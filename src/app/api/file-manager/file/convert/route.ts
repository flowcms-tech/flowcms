import { NextRequest, NextResponse } from "next/server"
// `Canvas` explicitly: `createCanvas` is overloaded and its inferred return
// type includes `SvgCanvas`, which has no `toBuffer`.
import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas"
import { StorageService } from "@/Framework/Storage/StorageService"
import { mediaPath } from "@/Framework/Storage/mediaUrl"
import { getFileCategory, isAllowedFileType } from "@/Framework/Functions/FileValidation"
import { UnsafeObjectKeyError, buildObjectKey } from "@/Framework/Storage/objectKey"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Re-encodes one stored image into another format, as a NEW object.
 *
 * IT NEVER TOUCHES THE SOURCE, and that is the whole safety model rather than a
 * default. Converting changes the extension, so the result is a different key —
 * and keys are the app's foreign keys, held in eight columns (`featuredImageKey`
 * is required on every post) and written straight into post bodies as `<img
 * src>`. Replacing an image would therefore orphan every reference to it, with
 * the damage showing up on the published site rather than as an error here. A
 * route that only ever adds cannot do that, so the reference problem is avoided
 * instead of managed.
 *
 * The two ways this could still overwrite something are refused explicitly
 * below: writing over the source itself, and writing over an unrelated file
 * that already holds the destination name.
 */

/**
 * What may be written, which is narrower than what the encoder can write.
 *
 * SVG is impossible: it is a vector description, and nothing reconstructs one
 * from pixels. GIF is possible — the installed encoder produces a valid
 * `GIF89a` — and is EXCLUDED ON PURPOSE rather than by oversight: a single
 * frame at 256 colours is a worse result than every other option here, so
 * offering it only invites someone to degrade an image by accident.
 */
const TARGETS = {
  png: "png",
  jpg: "jpg",
  webp: "webp",
  avif: "avif",
} as const

type TargetFormat = keyof typeof TARGETS

const MIME: Record<TargetFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
}

/**
 * A byte cap is not a pixel cap.
 *
 * Decoding materialises the whole image as RGBA, so a modest 50 MB JPEG at
 * 12000x9000 becomes ~430 MB of resident memory before a single byte is
 * encoded — enough to take the process down. The limit is on the DIMENSIONS for
 * that reason, and it is checked after decoding the header but before the
 * canvas is allocated.
 */
const MAX_PIXELS = 25_000_000

/**
 * 0-100, NOT 0-1.
 *
 * The browser's `canvas.toBlob` takes a 0-1 fraction and this encoder does not:
 * it floors anything below 1 to zero, so a plausible-looking `0.9` silently
 * produces the worst possible output rather than the best. Verified against the
 * installed build — `0.3` and `0.9` return byte-identical files.
 */
const DEFAULT_QUALITY = 82

/**
 * Each format takes its quality differently, and the type system is the only
 * thing that says so: JPEG and WebP take a bare number, AVIF takes a config
 * object, and PNG takes neither. One `toBuffer(mime, quality)` call for all of
 * them does not compile, and casting past that would have silently dropped the
 * setting for AVIF.
 */
function encode(canvas: Canvas, format: TargetFormat): Buffer {
  switch (format) {
    case "jpg":
      return canvas.toBuffer("image/jpeg", DEFAULT_QUALITY)
    case "webp":
      return canvas.toBuffer("image/webp", DEFAULT_QUALITY)
    case "avif":
      return canvas.toBuffer("image/avif", { quality: DEFAULT_QUALITY })
    case "png":
      return canvas.toBuffer("image/png")
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const payload = await request.json().catch(() => null)
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ message: "Invalid request" }, { status: 422 })
  }

  const body = payload as Record<string, unknown>
  const key = typeof body.key === "string" ? body.key : ""
  const format = typeof body.format === "string" ? body.format.toLowerCase() : ""
  const name = typeof body.name === "string" ? body.name.trim() : ""
  const destination = typeof body.destination === "string" ? body.destination : null

  const target = TARGETS[format as TargetFormat]
  if (!key || !target) {
    return NextResponse.json({ message: "Invalid conversion request" }, { status: 422 })
  }

  if (getFileCategory(key) !== "image") {
    return NextResponse.json({ message: ["Only images can be converted."] }, { status: 422 })
  }

  // An omitted destination means "beside the original", which is the case the
  // File Manager sends most often.
  const prefix = destination ?? key.slice(0, key.lastIndexOf("/") + 1)
  const stem = name || (key.split("/").pop() ?? key).replace(/\.[^.]+$/, "")

  let newKey: string
  try {
    newKey = buildObjectKey(prefix, `${stem}.${target}`)
  } catch (error) {
    const message =
      error instanceof UnsafeObjectKeyError ? error.message : "That destination is not valid."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }

  // Re-checked on the SANITISED key: sanitisation can change the trailing
  // characters, and the allowlist has to apply to what is actually written.
  if (!isAllowedFileType(newKey)) {
    return NextResponse.json({ message: "This file type is not allowed" }, { status: 422 })
  }

  // THE CASE THAT LOOKS LIKE A NO-OP AND IS NOT. Re-encoding a JPEG as a JPEG
  // in its own folder under its own name produces the source's exact key, which
  // would overwrite the original this route promises never to touch.
  if (newKey === key) {
    return NextResponse.json(
      {
        message: [
          "That would overwrite the original. Choose a different name, folder, or format.",
        ],
      },
      { status: 422 }
    )
  }

  // Someone else's file holding the name we are about to write is worse than
  // touching the source, because nobody was thinking about that file at all.
  const existing = await StorageService.listDirectory(newKey.slice(0, newKey.lastIndexOf("/") + 1))
  if (existing.files.some((candidate) => candidate.key === newKey)) {
    return NextResponse.json(
      { message: [`"${newKey.split("/").pop()}" already exists in that folder.`] },
      { status: 422 }
    )
  }

  let source: Buffer
  try {
    source = await StorageService.downloadObject(key)
  } catch {
    return NextResponse.json({ message: "That file could not be read." }, { status: 404 })
  }

  let output: Buffer
  try {
    const image = await loadImage(source)

    // An SVG carrying neither width/height nor a viewBox reports 0x0, and a
    // zero-sized canvas would be written out as an empty file rather than an
    // error. Verified against the installed decoder.
    if (!image.width || !image.height) {
      return NextResponse.json(
        { message: ["That image has no intrinsic size, so there is nothing to convert it to."] },
        { status: 422 }
      )
    }

    if (image.width * image.height > MAX_PIXELS) {
      return NextResponse.json(
        {
          message: [
            `That image is ${image.width}x${image.height}. The limit for conversion is ` +
              `${MAX_PIXELS / 1_000_000} megapixels.`,
          ],
        },
        { status: 422 }
      )
    }

    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext("2d")

    // JPEG has no alpha. Without this the transparent areas of a PNG or SVG
    // composite against nothing and arrive black, which reads as a corrupt file
    // rather than as a format limitation.
    if (target === "jpg") {
      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, image.width, image.height)
    }

    context.drawImage(image, 0, 0)
    output = encode(canvas, target)
  } catch {
    return NextResponse.json(
      { message: ["That image could not be decoded."] },
      { status: 422 }
    )
  }

  await StorageService.uploadObject(newKey, output, MIME[target])

  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "file",
    entityId: newKey,
    entityLabel: newKey,
    summary: `Converted from ${key} (${(output.length / 1024).toFixed(0)} KB)`,
  })

  return NextResponse.json({
    data: {
      id: newKey,
      name: newKey.split("/").pop() || newKey,
      size: output.length,
      lastModified: new Date().toISOString(),
      thumbnailUrl: mediaPath(newKey),
    },
    message: "Image converted",
  })
}
