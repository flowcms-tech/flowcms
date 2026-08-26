'use client'

import { useEffect, useRef, useState } from 'react'
import { Editor } from '@tinymce/tinymce-react'
import type { Editor as TinyMCEEditorInstance } from 'tinymce'
import { Controller, useFormContext, type Control, type FieldValues, type UseFormReturn } from 'react-hook-form'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { ClassValue } from 'clsx'
import ElementLabelHint from '@/components/shared/ElementLabelHint/ElementLabelHint'
import ElementFileSelectorModal from '@/components/shared/ElementFileSelector/ElementFileSelectorModal'
import type { FileSelectorItem } from '@/components/shared/ElementFileSelector/ElementFileSelector.api'
import { FileManagerServices } from '@/Modules/FileManager/Services/FileManagerServices'
import { publicImagePath } from '@/Framework/Storage/publicImageUrl'
import ElementToast from '@/components/shared/ElementToast/ElementToast'

export interface ElementEditorClassNames {
  root?: ClassValue
  label?: ClassValue
  requiredMark?: ClassValue
  editorWrapper?: ClassValue
  error?: ClassValue
  hint?: ClassValue
}

export interface ElementEditorProps {
  name?: string
  control?: Control<FieldValues>
  value?: string
  onChange?: (value: string) => void
  label?: string
  placeholder?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  height?: number
  plugins?: string[]
  toolbar?: string
  errorVariant?: 'default' | 'boxBelow'
  classNames?: ElementEditorClassNames
  /** Hands the live TinyMCE instance to the parent once it is ready.
   *  Needed by anything that has to write at the cursor rather than replace the
   *  whole value — the internal-link suggestions panel inserts an `<a>` where
   *  the caret is, which is impossible through the controlled `value` alone. */
  onEditorInit?: (editor: TinyMCEEditorInstance) => void
}

interface CoreProps {
  name?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: { message?: string }
  label?: string
  placeholder?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  height: number
  plugins: string[]
  toolbar: string
  errorVariant: 'default' | 'boxBelow'
  classNames: ElementEditorClassNames
  onEditorInit?: (editor: TinyMCEEditorInstance) => void
}

const DEFAULT_PLUGINS = ['lists', 'link', 'image', 'table', 'code', 'autolink', 'wordcount']
const DEFAULT_TOOLBAR =
  'undo redo | blocks | bold italic underline strikethrough | bullist numlist | link imagepicker table | alignleft aligncenter alignright | removeformat code'

/** TinyMCE's toolbar background/header chrome is hardcoded per-skin (not
 *  driven by its `--tox-private-*` variables), so matching the app's
 *  light/dark mode means switching the whole skin, not just recoloring it.
 *  Reactive to live toggles from ThemeSelectorModal (no page reload). */
function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  useEffect(() => {
    const root = document.documentElement
    const update = () => setIsDark(root.classList.contains('dark'))
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return isDark
}

/** The toolbar/menus/dialogs live in the main document, so they pick up the
 *  `--tox-private-*` overrides in globals.css automatically. The editable
 *  area is a separate iframe document and can't see those CSS variables, so
 *  its colors are read from the current theme and patched in directly. */
function applyAppThemeToEditor(editor: TinyMCEEditorInstance) {
  const body = editor.getBody()
  const doc = editor.getDoc()
  if (!body || !doc) return

  const rootStyles = getComputedStyle(document.documentElement)
  const get = (token: string) => rootStyles.getPropertyValue(token).trim()
  const background = get('--background')
  const foreground = get('--foreground')
  const primary = get('--primary')
  const border = get('--border')
  const muted = get('--muted')

  editor.dom.setStyles(body, { 'background-color': background, color: foreground })

  let styleEl = doc.getElementById('app-theme-overrides')
  if (!styleEl) {
    styleEl = doc.createElement('style')
    styleEl.id = 'app-theme-overrides'
    doc.head.appendChild(styleEl)
  }
  styleEl.textContent = `
    a { color: ${primary}; }
    blockquote { border-inline-start-color: ${border}; }
    code, pre { background-color: ${muted}; }
    hr { border-color: ${border}; }
  `
}

/** Word (and most rich-text sources) paste images as `data:` URIs. We never
 *  want those landing in stored content, so every pasted image is uploaded
 *  to the file manager under PASTE_UPLOAD_PREFIX and its src swapped for the
 *  uploaded file's URL — same "always goes through the file manager" rule as
 *  manual insertion via the toolbar button. */
const PASTE_UPLOAD_PREFIX = 'posts/'

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

async function dataUriToFile(dataUri: string, filename: string): Promise<File> {
  const res = await fetch(dataUri)
  const blob = await res.blob()
  return new File([blob], filename, { type: blob.type })
}

let ensurePasteDirPromise: Promise<void> | null = null
function ensurePasteUploadDirectory(): Promise<void> {
  if (!ensurePasteDirPromise) {
    ensurePasteDirPromise = FileManagerServices.createDirectory('', 'posts').catch(() => undefined)
  }
  return ensurePasteDirPromise
}

async function uploadPastedImages(editor: TinyMCEEditorInstance, container: HTMLElement) {
  const images = Array.from(container.querySelectorAll<HTMLImageElement>('img[src^="data:"]'))
  if (images.length === 0) return

  const toastId = ElementToast.loading(`Uploading ${images.length} pasted image${images.length === 1 ? '' : 's'}…`)
  await ensurePasteUploadDirectory()

  let failed = 0
  await Promise.all(
    images.map(async (img, index) => {
      const mime = img.src.slice(5, img.src.indexOf(';'))
      const extension = MIME_EXTENSIONS[mime] ?? 'png'
      const filename = `pasted-${Date.now()}-${index}.${extension}`
      try {
        const file = await dataUriToFile(img.src, filename)
        const uploaded = await FileManagerServices.upload(file, PASTE_UPLOAD_PREFIX)
        // NOT `uploaded.thumbnailUrl` — that is a presigned S3 URL with a 1 h
        // TTL, and this src is about to be saved into the post body and served
        // publicly for years. Using it meant every in-content image 404'd an
        // hour after it was written, silently, and no crawler ever saw one.
        // `id` is the S3 key — the file-manager route serializes `id: obj.key`.
        editor.dom.setAttrib(img, 'src', publicImagePath(uploaded.id))
      } catch {
        failed += 1
        img.remove()
      }
    })
  )

  if (failed > 0) {
    ElementToast.error(`${failed} pasted image${failed === 1 ? '' : 's'} failed to upload and ${failed === 1 ? 'was' : 'were'} removed.`, { id: toastId })
  } else {
    ElementToast.success('Pasted images uploaded.', { id: toastId })
  }
}

function Core({
  name, value, onChange, onBlur, error, label, placeholder, hint, required, disabled,
  height, plugins, toolbar, errorVariant, classNames, onEditorInit,
}: CoreProps) {
  const editorRef = useRef<TinyMCEEditorInstance | null>(null)
  const isDark = useIsDarkTheme()
  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false)

  return (
    <div className={cn('flex flex-col gap-1.5', classNames.root)}>
      {label && (
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={name}
            className={cn(
              'text-sm font-medium leading-none',
              error ? 'text-destructive' : 'text-foreground',
              disabled && 'opacity-50 cursor-not-allowed',
              classNames.label
            )}
          >
            {label}
            {required && <span className={cn('mx-0.5 text-destructive', classNames.requiredMark)}>*</span>}
          </label>
          {hint && <ElementLabelHint id={`${name}-hint`} text={hint} />}
        </div>
      )}

      <div
        className={cn(
          '[&_.tox-tinymce]:transition-colors',
          error && '[&_.tox-tinymce]:!border-destructive',
          errorVariant === 'boxBelow' && error && '[&_.tox-tinymce]:!rounded-b-none [&_.tox-tinymce]:!border-b-0',
          disabled && 'pointer-events-none opacity-50',
          classNames.editorWrapper
        )}
      >
        <Editor
          key={isDark ? 'dark' : 'light'}
          id={name}
          value={value}
          onEditorChange={(content) => onChange(content)}
          onBlur={onBlur}
          disabled={disabled}
          tinymceScriptSrc="/assets/tinymce/tinymce.min.js"
          licenseKey="gpl"
          onInit={(_evt, editor) => {
            editorRef.current = editor
            applyAppThemeToEditor(editor)
            onEditorInit?.(editor)
          }}
          init={{
            height,
            menubar: false,
            branding: false,
            statusbar: false,
            placeholder,
            plugins: plugins.join(' '),
            toolbar,
            skin: isDark ? 'oxide-dark' : 'oxide',
            content_css: isDark ? 'dark' : 'default',
            content_style: 'body { font-family: inherit; font-size: 14px; }',
            // No images_upload_handler/images_upload_url is configured and
            // the "image" plugin's own toolbar button is never registered
            // (we register "imagepicker" instead) — there's no direct-upload
            // dialog to reach; the only way to manually insert an image is
            // through our file manager modal below. Pasted images (e.g. from
            // Word) are allowed in so PastePostProcess can catch and upload
            // them the same way — see uploadPastedImages.
            automatic_uploads: false,
            paste_data_images: true,
            setup: (editor) => {
              const openPicker = () => setIsImagePickerOpen(true)
              editor.ui.registry.addButton('imagepicker', {
                icon: 'image',
                tooltip: 'Insert image',
                onAction: openPicker,
              })
              editor.on('PastePostProcess', (evt) => {
                uploadPastedImages(editor, evt.node)
              })
            },
          }}
        />
      </div>

      <ElementFileSelectorModal
        isOpen={isImagePickerOpen}
        onClose={() => setIsImagePickerOpen(false)}
        multiple={false}
        accept="image"
        onSelectSingle={(item: FileSelectorItem) => {
          const editor = editorRef.current
          if (editor) {
            // Public route, not `item.thumbnailUrl` — see uploadPastedImages.
            // A presigned URL persisted into the body dies within the hour.
            editor.insertContent(
              editor.dom.createHTML('img', { src: publicImagePath(item.id), alt: item.name })
            )
            editor.focus()
          }
          setIsImagePickerOpen(false)
        }}
        onSelectMultiple={() => {}}
      />

      <AnimatePresence initial={false}>
        {errorVariant === 'boxBelow' && error && (
          <motion.div
            id={`${name}-error`}
            role="alert"
            key="box-error"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div
              className={cn(
                'rounded-b-lg border border-t-0 border-destructive bg-destructive/5 px-2.5 py-2 text-sm text-destructive',
                classNames.error
              )}
            >
              {error.message}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {errorVariant === 'default' && error && (
          <motion.p
            id={`${name}-error`}
            role="alert"
            key="default-error"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={cn('text-sm text-destructive', classNames.error)}
          >
            {error.message}
          </motion.p>
        )}
      </AnimatePresence>

    </div>
  )
}

export default function ElementEditor({
  name,
  control: controlProp,
  value: valueProp,
  onChange: onChangeProp,
  label,
  placeholder,
  hint,
  required = false,
  disabled = false,
  height = 400,
  plugins = DEFAULT_PLUGINS,
  toolbar = DEFAULT_TOOLBAR,
  errorVariant = 'default',
  classNames = {},
  onEditorInit,
}: ElementEditorProps) {
  const formCtx = useFormContext() as UseFormReturn | null
  const effectiveControl = controlProp ?? formCtx?.control

  if (name && effectiveControl) {
    return (
      <Controller
        name={name}
        control={effectiveControl}
        defaultValue=""
        render={({ field, fieldState: { error } }) => (
          <Core
            name={name}
            value={field.value ?? ''}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={error}
            label={label}
            placeholder={placeholder}
            hint={hint}
            required={required}
            disabled={disabled}
            height={height}
            plugins={plugins}
            toolbar={toolbar}
            errorVariant={errorVariant}
            classNames={classNames}
            onEditorInit={onEditorInit}
          />
        )}
      />
    )
  }

  return (
    <Core
      name={name}
      value={valueProp ?? ''}
      onChange={(v) => onChangeProp?.(v)}
      label={label}
      placeholder={placeholder}
      hint={hint}
      required={required}
      disabled={disabled}
      height={height}
      plugins={plugins}
      toolbar={toolbar}
      errorVariant={errorVariant}
      classNames={classNames}
      onEditorInit={onEditorInit}
    />
  )
}
