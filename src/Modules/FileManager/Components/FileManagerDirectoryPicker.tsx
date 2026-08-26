'use client'

import { useState } from 'react'
import { Home } from 'lucide-react'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import FileManagerTreeNode from './FileManagerTreeNode'

interface FileManagerDirectoryPickerProps {
  isOpen: boolean
  title: string
  confirmText: string
  isSubmitting: boolean
  onClose: () => void
  onConfirm: (destination: string) => void
}

export default function FileManagerDirectoryPicker({
  isOpen,
  title,
  confirmText,
  isSubmitting,
  onClose,
  onConfirm,
}: FileManagerDirectoryPickerProps) {
  const [pickedPrefix, setPickedPrefix] = useState('')

  function handleClose() {
    setPickedPrefix('')
    onClose()
  }

  return (
    <ElementModal
      isOpen={isOpen}
      onClose={(open) => { if (!open) handleClose() }}
      title={title}
      size="sm"
      footer={
        <ElementModal.Footer>
          <ElementButton variant="cancel" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton onClick={() => onConfirm(pickedPrefix)} isLoading={isSubmitting}>
            {confirmText}
          </ElementButton>
        </ElementModal.Footer>
      }
    >
      <div className="flex flex-col gap-0.5">
        <FileManagerTreeNode
          prefix=""
          name="Home"
          depth={0}
          selectedPrefix={pickedPrefix}
          onSelect={setPickedPrefix}
          showActions={false}
          icon={<Home size={14} className="shrink-0 text-muted-foreground" />}
          defaultExpanded
        />
      </div>
    </ElementModal>
  )
}
