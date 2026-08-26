import { StorageService } from "@/Framework/Storage/StorageService"

export function computeFileTransferKey(sourceKey: string, destinationPrefix: string): string | null {
  const baseName = sourceKey.split("/").pop()
  if (!baseName) return null
  return `${destinationPrefix}${baseName}`
}

export async function validateFileDestination(
  sourceKey: string,
  destinationPrefix: string,
  newKey: string
): Promise<string | null> {
  if (newKey === sourceKey) {
    return null
  }
  const existing = await StorageService.listDirectory(destinationPrefix)
  if (existing.files.some((f) => f.key === newKey)) {
    return "A file with that name already exists at the destination"
  }
  return null
}
