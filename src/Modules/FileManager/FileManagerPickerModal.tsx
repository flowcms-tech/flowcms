'use client'

import ElementModal from '@/components/shared/ElementModal/ElementModal'
import type { FileCategory } from '@/Framework/Functions/FileValidation'
import FileManagerBrowser from './FileManagerBrowser'

/**
 * The File Manager, in a dialog.
 *
 * A shell, and deliberately nothing more — it owns the frame and the height,
 * and `FileManagerBrowser` owns everything inside it. That is what makes the
 * dialog and the admin page the same tool rather than two that resemble each
 * other: there is no file-manager UI here to fall behind.
 *
 * MOUNTED ONLY WHILE OPEN. The browser lists every visible tree node eagerly so
 * empty folders can hide their expander, so it should not be doing that behind
 * a closed dialog.
 */
export default function FileManagerPickerModal({
  isOpen,
  onClose,
  multiple = false,
  accept,
  onConfirm,
  title = 'Select File',
}: {
  isOpen: boolean
  onClose: () => void
  multiple?: boolean
  accept?: FileCategory | FileCategory[]
  /** Storage keys, in selection order. */
  onConfirm: (keys: string[]) => void
  title?: string
}) {
  if (!isOpen) return null

  return (
    <ElementModal
      isOpen
      onClose={(open) => { if (!open) onClose() }}
      title={title}
      size="xl"
      classNames={{
        // The HEIGHT is set on the dialog, not on the content inside it, so the
        // header is accounted for automatically. A fixed height on the content
        // plus the header can exceed the dialog's own 90vh cap and be clipped.
        content: 'h-[90vh]',
        // The browser scrolls its own panes; a scrollbar on the dialog body
        // would be a second one wrapped around them.
        body: 'p-4 overflow-hidden',
      }}
    >
      <div className="flex h-full flex-col">
        <FileManagerBrowser
          selection={{
            mode: multiple ? 'multiple' : 'single',
            accept,
            onConfirm,
          }}
        />
      </div>
    </ElementModal>
  )
}
