import { FileArchive, FileSpreadsheet, FileText, FileVideo, File as FileIconLucide } from 'lucide-react'
import { getFileCategory } from '@/Framework/Functions/FileValidation'

interface FileManagerFileIconProps {
  name: string
  size?: number
  className?: string
}

export default function FileManagerFileIcon({ name, size = 20, className }: FileManagerFileIconProps) {
  const category = getFileCategory(name)
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()

  if (category === 'video') return <FileVideo size={size} className={className} />
  if (category === 'archive') return <FileArchive size={size} className={className} />
  if (category === 'document') {
    if (extension === 'xls' || extension === 'xlsx') {
      return <FileSpreadsheet size={size} className={className} />
    }
    return <FileText size={size} className={className} />
  }
  return <FileIconLucide size={size} className={className} />
}
