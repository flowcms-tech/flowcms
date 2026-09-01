'use client'

import { useState, type ReactNode } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import { parseDate } from '@/Framework/Functions/DateFunctions'
import { getFileCategory, getFileExtension } from '@/Framework/Functions/FileValidation'
import { mediaDownloadPath, mediaPath } from '@/Framework/Storage/mediaUrl'
import FileManagerFileIcon from './FileManagerFileIcon'
import { formatBytes, formatExactBytes, parentPrefixOf } from '../Values/FileManagerFormat'
import type { FileManagerItem } from '../Types'

/**
 * Everything the browser already knows about one stored object.
 *
 * Nothing here is fetched: the listing that drew the row carries the key, size
 * and modification time, and the rest is derived from them. The stored MIME
 * type, ETag and checksum are deliberately absent rather than guessed — the
 * storage driver exposes no head operation, so there is nowhere honest to read
 * them from.
 */

const CATEGORY_LABELS: Record<ReturnType<typeof getFileCategory>, string> = {
  image: 'Image',
  video: 'Video',
  archive: 'Archive',
  document: 'Document',
  unknown: 'File',
}

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </>
  )
}

function CopyableValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused outright (an insecure origin, a denied
      // permission). The value stays on screen and selectable, so there is
      // nothing to report and nothing lost.
    }
  }

  return (
    <div className="flex items-start gap-1.5">
      <span className="min-w-0 flex-1 break-all font-mono text-xs leading-5">{value}</span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : `Copy ${value}`}
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? <Check size={13} className="text-primary" /> : <Copy size={13} />}
      </button>
    </div>
  )
}

export default function FileManagerFilePropertiesModal({
  file,
  onClose,
}: {
  file: FileManagerItem
  onClose: () => void
}) {
  // Measured off the preview once it decodes, which is the only way to learn an
  // image's size without a round trip of our own.
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)

  const extension = getFileExtension(file.name)
  const kind = CATEGORY_LABELS[getFileCategory(file.name)]
  const directory = parentPrefixOf(file.id)

  return (
    <ElementModal
      isOpen
      onClose={(open) => { if (!open) onClose() }}
      title="File Properties"
      size="sm"
      footer={
        <ElementModal.Footer>
          <ElementButton variant="cancel" onClick={onClose}>
            Close
          </ElementButton>
          {/*
            A link, not a button with a handler: the route answers `download=1`
            with `Content-Disposition: attachment`, so the browser saves the file
            instead of navigating, and the same-origin request carries the
            session cookie the media route requires.

            `download` is REQUIRED even though the server names the file. The
            app-wide progress provider inspects anchor clicks and treats one
            without this attribute as a route change — so the top bar and its
            corner spinner would start on a navigation that never happens, and
            never stop.
          */}
          <ElementButton asChild>
            <a href={mediaDownloadPath(file.id)} download>
              <Download size={15} />
              Download
            </a>
          </ElementButton>
        </ElementModal.Footer>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
            {file.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={file.thumbnailUrl}
                alt=""
                className="size-full object-cover"
                onLoad={(e) =>
                  setDimensions({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  })
                }
              />
            ) : (
              <FileManagerFileIcon name={file.name} size={32} className="text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="break-words text-sm font-medium">{file.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {extension ? `${kind} · ${extension.toUpperCase()}` : kind}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-[6.5rem_1fr] items-baseline gap-x-4 gap-y-3 border-t border-border pt-5">
          <PropertyRow label="Size">
            {formatBytes(file.size)}{' '}
            <span className="text-muted-foreground">({formatExactBytes(file.size)})</span>
          </PropertyRow>

          {dimensions && (
            <PropertyRow label="Dimensions">
              {dimensions.width} × {dimensions.height} px
            </PropertyRow>
          )}

          <PropertyRow label="Location">
            {directory ? directory.replace(/\/$/, '') : 'Home'}
          </PropertyRow>

          <PropertyRow label="Path">
            <CopyableValue value={file.id} />
          </PropertyRow>

          <PropertyRow label="URL">
            <CopyableValue value={mediaPath(file.id)} />
          </PropertyRow>

          <PropertyRow label="Modified">
            {parseDate(file.lastModified).toDateTime()}
          </PropertyRow>
        </dl>
      </div>
    </ElementModal>
  )
}
