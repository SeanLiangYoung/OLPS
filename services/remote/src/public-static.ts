import fs from 'node:fs/promises'
import path from 'node:path'

export async function resolvePublishedPublicFile(
  liveRoot: string,
  relativeInput: string,
): Promise<string | null> {
  const normalized = relativeInput.replace(/\\/g, '/').replace(/^\/+/, '')
  const candidates: string[] = []
  if (!normalized) {
    candidates.push('index.html')
  } else if (normalized.endsWith('/')) {
    candidates.push(`${normalized}index.html`)
  } else {
    candidates.push(normalized)
    candidates.push(`${normalized}/index.html`)
  }

  const root = path.resolve(liveRoot)
  for (const rel of candidates) {
    const filePath = path.resolve(root, rel)
    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      continue
    }
    try {
      const stat = await fs.lstat(filePath)
      if (stat.isSymbolicLink()) {
        continue
      }
      if (stat.isFile()) {
        return filePath
      }
      if (stat.isDirectory()) {
        const indexPath = path.join(filePath, 'index.html')
        const indexStat = await fs.lstat(indexPath)
        if (!indexStat.isSymbolicLink() && indexStat.isFile()) {
          return indexPath
        }
      }
    } catch {
      continue
    }
  }
  return null
}
