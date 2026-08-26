export interface FileManagerItem extends Record<string, unknown> {
  id: string
  name: string
  size: number
  lastModified: string
  thumbnailUrl?: string
}

export interface FileManagerDirectoryListing {
  directories: string[]
  files: FileManagerItem[]
}
