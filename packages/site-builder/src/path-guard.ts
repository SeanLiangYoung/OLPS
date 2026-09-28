import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveInsideWorkspace } from './paths.js'

export async function assertNotSymlinkOrJunction(filePath: string): Promise<void> {
  const stat = await fs.lstat(filePath)
  if (stat.isSymbolicLink()) {
    throw new Error(`不允许符号链接或 junction: ${filePath}`)
  }
}

export async function assertSafePathChain(
  workspacePath: string,
  relativePath: string,
  options?: { allowMissingSuffix?: boolean },
): Promise<string> {
  const abs = resolveInsideWorkspace(workspacePath, relativePath)
  const root = path.resolve(workspacePath)
  let cursor = root
  const rel = path.relative(root, abs)
  const parts = rel.split(path.sep).filter(Boolean)
  await assertNotSymlinkOrJunction(root)
  for (const part of parts) {
    cursor = path.join(cursor, part)
    try {
      await assertNotSymlinkOrJunction(cursor)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (options?.allowMissingSuffix && code === 'ENOENT') {
        return abs
      }
      throw err
    }
  }
  return abs
}
