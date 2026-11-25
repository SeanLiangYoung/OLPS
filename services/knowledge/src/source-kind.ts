export type SourceKind = 'text' | 'image' | 'video' | 'unsupported'

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.docx', '.xlsx', '.pdf'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm'])

export function classifySourceByExtension(fileName: string): SourceKind {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) {
    return 'unsupported'
  }
  const ext = fileName.slice(dot).toLowerCase()
  if (TEXT_EXTENSIONS.has(ext)) {
    return 'text'
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image'
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return 'video'
  }
  return 'unsupported'
}

export function mimeTypeForSourceExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) {
    return null
  }
  const ext = fileName.slice(dot).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  }
  return map[ext] ?? null
}