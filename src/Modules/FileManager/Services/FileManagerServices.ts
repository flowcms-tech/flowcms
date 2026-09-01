import BAPI from '@/Framework/API_Layer'
import type { FileManagerDirectoryListing, FileManagerItem } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const FileManagerServices = {
  async listDirectory(prefix: string): Promise<FileManagerDirectoryListing> {
    const res = await BAPI.get<ApiResponse<FileManagerDirectoryListing>>(
      '/api/file-manager',
      { params: { prefix }, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async upload(file: File, prefix: string, onProgress?: (percent: number) => void): Promise<FileManagerItem> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('prefix', prefix)
    const res = await BAPI.post<ApiResponse<FileManagerItem>>('/api/file-manager', fd, {
      showGlobalError: true,
      showGlobalSuccess: false,
      onUploadProgress: (event) => {
        if (onProgress && event.total) {
          onProgress(Math.round((event.loaded / event.total) * 100))
        }
      },
    })
    return res.data
  },

  async createDirectory(prefix: string, name: string): Promise<void> {
    await BAPI.post(
      '/api/file-manager/directory',
      { prefix, name },
      { showGlobalError: true, showGlobalSuccess: false }
    )
  },

  async renameDirectory(prefix: string, name: string): Promise<void> {
    await BAPI.patch(
      '/api/file-manager/directory',
      { prefix, name },
      { showGlobalError: true, showGlobalSuccess: false }
    )
  },

  async moveDirectory(prefix: string, destination: string): Promise<void> {
    await BAPI.post(
      '/api/file-manager/directory/move',
      { prefix, destination },
      { showGlobalError: true, showGlobalSuccess: false }
    )
  },

  async copyDirectory(prefix: string, destination: string): Promise<void> {
    await BAPI.post(
      '/api/file-manager/directory/copy',
      { prefix, destination },
      { showGlobalError: true, showGlobalSuccess: false }
    )
  },

  async deleteDirectory(prefix: string): Promise<void> {
    await BAPI.delete(
      '/api/file-manager/directory',
      { prefix },
      { showGlobalError: true, showGlobalSuccess: false }
    )
  },

  async renameFile(key: string, name: string): Promise<void> {
    await BAPI.patch(
      '/api/file-manager/file',
      { key, name },
      { showGlobalError: true, showGlobalSuccess: false }
    )
  },

  async moveFile(key: string, destination: string): Promise<void> {
    await BAPI.post(
      '/api/file-manager/file/move',
      { key, destination },
      { showGlobalError: true, showGlobalSuccess: false }
    )
  },

  async copyFile(key: string, destination: string): Promise<void> {
    await BAPI.post(
      '/api/file-manager/file/copy',
      { key, destination },
      { showGlobalError: true, showGlobalSuccess: false }
    )
  },

  /** Writes a NEW object; the source is never modified or removed. */
  async convertFile(input: {
    key: string
    format: 'png' | 'jpg' | 'webp' | 'avif'
    name: string
    destination: string
  }): Promise<FileManagerItem> {
    const res = await BAPI.post<ApiResponse<FileManagerItem>>(
      '/api/file-manager/file/convert',
      input,
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async deleteFile(key: string): Promise<void> {
    await BAPI.delete(
      '/api/file-manager/file',
      { key },
      { showGlobalError: true, showGlobalSuccess: false }
    )
  },
}
