export class ImportPathError extends Error {
  readonly code = 'import_invalid_path' as const
}

export function normalizeSourceRelativePath(relativePath: string): string {
  const trimmed = relativePath.trim()
  if (trimmed === '') {
    throw new ImportPathError('empty relative path')
  }
  const posix = trimmed.split('\\').join('/')
  if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix)) {
    throw new ImportPathError('absolute path')
  }
  if (posix.includes('\0')) {
    throw new ImportPathError('nul in path')
  }
  const parts = posix.split('/').filter((segment) => segment.length > 0)
  if (parts.length === 0) {
    throw new ImportPathError('empty path after normalize')
  }
  if (parts.some((segment) => segment === '..' || segment === '.')) {
    throw new ImportPathError('dot segment')
  }
  return parts.join('/')
}