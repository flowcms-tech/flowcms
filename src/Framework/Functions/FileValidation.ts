const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp']

const VIDEO_EXTENSIONS = [
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v',
  'mpg', 'mpeg', '3gp', '3g2', 'ogv', 'ts', 'm2ts',
]

const ARCHIVE_EXTENSIONS = ['rar', 'zip']

const DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx']

export const ALLOWED_FILE_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...ARCHIVE_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
]

export const ALLOWED_FILE_ACCEPT_ATTRIBUTE = ALLOWED_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(',')

export function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex === -1 || dotIndex === filename.length - 1) return ''
  return filename.slice(dotIndex + 1).toLowerCase()
}

export function isAllowedFileType(filename: string): boolean {
  const extension = getFileExtension(filename)
  return extension !== '' && ALLOWED_FILE_EXTENSIONS.includes(extension)
}

export type FileCategory = 'image' | 'video' | 'archive' | 'document' | 'unknown'

export function getFileCategory(filename: string): FileCategory {
  const extension = getFileExtension(filename)
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image'
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video'
  if (ARCHIVE_EXTENSIONS.includes(extension)) return 'archive'
  if (DOCUMENT_EXTENSIONS.includes(extension)) return 'document'
  return 'unknown'
}
