'use client'

import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementButton from '@/components/shared/ElementButton/ElementButton'

interface FileManagerUploadConflictModalProps {
  isOpen: boolean
  conflictNames: string[]
  onReplace: () => void
  onSkip: () => void
  onCancel: () => void
}

export default function FileManagerUploadConflictModal({
  isOpen,
  conflictNames,
  onReplace,
  onSkip,
  onCancel,
}: FileManagerUploadConflictModalProps) {
  const isPlural = conflictNames.length > 1

  return (
    <ElementModal
      isOpen={isOpen}
      onClose={(open) => { if (!open) onCancel() }}
      title="File Already Exists"
      size="sm"
      footer={
        <ElementModal.Footer>
          <ElementButton variant="cancel" onClick={onCancel}>
            Cancel Upload
          </ElementButton>
          <ElementButton variant="outline" onClick={onSkip}>
            Skip {isPlural ? 'Duplicates' : 'This File'}
          </ElementButton>
          <ElementButton onClick={onReplace}>
            Replace
          </ElementButton>
        </ElementModal.Footer>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">
          {isPlural
            ? `${conflictNames.length} files with these names already exist in this directory:`
            : 'A file with this name already exists in this directory:'}
        </p>
        <ul className="flex flex-col gap-1 rounded-md border border-border bg-muted/50 p-2">
          {conflictNames.map((name) => (
            <li key={name} className="truncate font-medium">{name}</li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          Replace {isPlural ? 'them' : 'it'}, skip {isPlural ? 'them' : 'it'} and upload the rest, or cancel the whole upload.
        </p>
      </div>
    </ElementModal>
  )
}
