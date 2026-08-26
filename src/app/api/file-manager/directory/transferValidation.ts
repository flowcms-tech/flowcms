import { StorageService } from "@/Framework/Storage/StorageService"

export function computeTransferPrefix(sourcePrefix: string, destinationPrefix: string): string | null {
  const baseName = sourcePrefix.split("/").filter(Boolean).pop()
  if (!baseName) return null
  return `${destinationPrefix}${baseName}/`
}

export async function validateTransferDestination(
  sourcePrefix: string,
  destinationPrefix: string,
  newPrefix: string
): Promise<string | null> {
  if (destinationPrefix.startsWith(sourcePrefix)) {
    return "Cannot move or copy a directory into itself or one of its own subdirectories"
  }
  if (newPrefix === sourcePrefix) {
    return null
  }
  const existing = await StorageService.listDirectory(destinationPrefix)
  if (existing.directories.includes(newPrefix)) {
    return "A directory with that name already exists at the destination"
  }
  return null
}
