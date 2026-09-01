import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { parseDate } from '@/Framework/Functions/DateFunctions'
import { mediaDownloadPath } from '@/Framework/Storage/mediaUrl'
import FileManagerFileIcon from '../Components/FileManagerFileIcon'
import FileManagerFileActionsMenu from '../Components/FileManagerFileActionsMenu'
import { formatBytes } from './FileManagerFormat'
import type { FileManagerItem } from '../Types'

export function buildColumns(
  onProperties: (file: FileManagerItem) => void,
  onRename: (file: FileManagerItem) => void,
  onMove: (file: FileManagerItem) => void,
  onCopy: (file: FileManagerItem) => void,
  onDelete: (file: FileManagerItem) => void,
): ExtendedColumnDef<FileManagerItem>[] {
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const file = row.original
        return (
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
              {file.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={file.thumbnailUrl} alt="" className="size-full object-cover" />
              ) : (
                <FileManagerFileIcon name={file.name} size={16} className="text-muted-foreground" />
              )}
            </div>
            <span className="truncate font-medium">{file.name}</span>
          </div>
        )
      },
    },
    {
      id: 'size',
      accessorKey: 'size',
      header: 'Size',
      cell: ({ getValue }) => <span className="text-sm text-muted-foreground">{formatBytes(getValue() as number)}</span>,
    },
    {
      id: 'lastModified',
      accessorKey: 'lastModified',
      header: 'Last Modified',
      cell: ({ getValue }) => <span className="text-sm">{parseDate(getValue() as string).toDateTime()}</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end">
          <FileManagerFileActionsMenu
            onProperties={() => onProperties(row.original)}
            downloadHref={mediaDownloadPath(row.original.id)}
            onRename={() => onRename(row.original)}
            onMove={() => onMove(row.original)}
            onCopy={() => onCopy(row.original)}
            onDelete={() => onDelete(row.original)}
          />
        </div>
      ),
    },
  ]
}
