import type { SourceReader } from './source-reader.js'

export function createMemorySourceReader(
  files: Record<string, string>,
): SourceReader {
  const normalized = new Map<string, string>()
  for (const [key, value] of Object.entries(files)) {
    normalized.set(key.replace(/\\/g, '/'), value)
  }

  return {
    async readText(relativePath: string): Promise<string> {
      const path = relativePath.replace(/\\/g, '/')
      const content = normalized.get(path)
      if (content === undefined) {
        const error = new Error(`ENOENT: ${path}`) as Error & { code: string }
        error.code = 'ENOENT'
        throw error
      }
      return content
    },
    async list(relativePath: string): Promise<string[]> {
      const prefix = relativePath === '' || relativePath === '.'
        ? ''
        : relativePath.replace(/\\/g, '/').replace(/\/$/, '')
      const children = new Set<string>()
      for (const filePath of normalized.keys()) {
        if (prefix === '') {
          const top = filePath.split('/')[0]
          if (top) {
            children.add(top)
          }
          continue
        }
        if (!filePath.startsWith(`${prefix}/`)) {
          continue
        }
        const rest = filePath.slice(prefix.length + 1)
        const child = rest.split('/')[0]
        if (child) {
          children.add(child)
        }
      }
      if (children.size === 0 && prefix !== '') {
        const error = new Error(`ENOENT: ${prefix}`) as Error & { code: string }
        error.code = 'ENOENT'
        throw error
      }
      return [...children].sort()
    },
  }
}
