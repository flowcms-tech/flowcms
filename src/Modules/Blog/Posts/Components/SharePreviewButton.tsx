'use client'

import { useState } from 'react'
import { Check, Copy, Share2 } from 'lucide-react'
import { format } from 'date-fns'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { PreviewLinkServices } from '../Services/PreviewLinkServices'
import {
  PREVIEW_EXPIRY_LABELS,
  type PreviewExpiry,
} from '@/Framework/Auth/previewToken'

interface SharePreviewButtonProps {
  postId: string
  className?: string
}

const EXPIRY_CHOICES: PreviewExpiry[] = ['24h', '7d', '30d']

/**
 * "Share preview" — a signed, expiring link to a draft's public URL.
 *
 * The copy is blunt about revocation on purpose. There is no token table, so a
 * link cannot be cancelled individually; the only way to invalidate one is to
 * rotate PREVIEW_SECRET, which invalidates all of them. A UI that showed a
 * "Revoke" button, or even said "expires in 7 days" without the rest, would
 * imply a control that does not exist — and someone would rely on it after
 * sending a link to the wrong address.
 */
export default function SharePreviewButton({ postId, className }: SharePreviewButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [expiry, setExpiry] = useState<PreviewExpiry>('7d')
  const [url, setUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const reset = () => {
    setUrl(null)
    setExpiresAt(null)
    setErrors([])
    setCopied(false)
  }

  const handleCreate = async () => {
    setErrors([])
    setIsLoading(true)
    try {
      const result = await PreviewLinkServices.create(postId, expiry)
      setUrl(result.url)
      setExpiresAt(result.expiresAt)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string | string[] } } }
      const raw = axiosErr.response?.data?.message
      setErrors(Array.isArray(raw) ? raw : raw ? [raw] : ['Could not create a preview link'])
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <ElementButton
        variant="outline"
        size="sm"
        className={className}
        onClick={() => { reset(); setIsOpen(true) }}
      >
        <Share2 size={15} />
        Share preview
      </ElementButton>

      <ElementModal
        isOpen={isOpen}
        onClose={(open) => { setIsOpen(open); if (!open) reset() }}
        title="Share a preview link"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Anyone with this link can read the post, published or not. It stops working
            when it expires.
          </p>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Link expires after</p>
            <div className="flex flex-wrap gap-1">
              {EXPIRY_CHOICES.map((choice) => (
                <ElementButton
                  key={choice}
                  size="sm"
                  variant={expiry === choice ? 'primary' : 'outline'}
                  onClick={() => { setExpiry(choice); reset() }}
                >
                  {PREVIEW_EXPIRY_LABELS[choice]}
                </ElementButton>
              ))}
            </div>
          </div>

          <ValidationBox messages={errors} />

          {url ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 text-xs">
                  {url}
                </code>
                <ElementButton size="sm" variant="outline" onClick={handleCopy}>
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? 'Copied' : 'Copy'}
                </ElementButton>
              </div>
              {expiresAt && (
                <p className="text-xs text-muted-foreground">
                  Expires {format(new Date(expiresAt), 'MMM d, yyyy, HH:mm')}
                </p>
              )}
            </div>
          ) : (
            <ElementButton onClick={handleCreate} isLoading={isLoading}>
              Create link
            </ElementButton>
          )}

          {/* The honest limitation, stated where it matters rather than in a
              doc nobody opens. */}
          <div className="rounded-lg border border-warning/40 bg-warning-light p-3 text-xs text-warning">
            <p className="font-medium">Preview links can&apos;t be cancelled individually.</p>
            <p className="mt-1 opacity-90">
              There is no list of issued links to revoke from. A link stops working when it
              expires, or when the server&apos;s PREVIEW_SECRET is rotated — which invalidates
              every preview link at once. Send them accordingly.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Preview pages are served with <code>X-Robots-Tag: noindex</code> and are never
            cached, so a leaked link cannot end up in search results.
          </p>
        </div>
      </ElementModal>
    </>
  )
}
