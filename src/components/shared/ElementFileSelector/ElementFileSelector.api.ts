import BAPI from '@/Framework/API_Layer'

export interface FileSelectorItem {
  id: string
  name: string
  size: number
  lastModified: string
  thumbnailUrl?: string
}

export interface FileSelectorDirectoryListing {
  directories: string[]
  files: FileSelectorItem[]
}

interface ApiResponse<T> { data: T; message: string | string[] }

export async function fetchFileSelectorDirectory(prefix: string): Promise<FileSelectorDirectoryListing> {
  const res = await BAPI.get<ApiResponse<FileSelectorDirectoryListing>>(
    '/api/file-manager',
    { params: { prefix }, showGlobalError: true, showGlobalSuccess: false }
  )
  return res.data
}
