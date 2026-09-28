import fs from 'node:fs/promises'
import path from 'node:path'

export type PreviewAssetFile = {
  relativePath: string
  content: Buffer
}

async function assertNotSymlinkOrJunction(filePath: string): Promise<void> {
  const stat = await fs.lstat(filePath)
  if (stat.isSymbolicLink()) {
    throw new Error(`不允许符号链接或 junction: ${filePath}`)
  }
}

function resolveInsideWorkspace(workspacePath: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  if (path.isAbsolute(normalized) || normalized.startsWith('/')) {
    throw new Error(`路径不允许绝对路径: ${relativePath}`)
  }
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error(`路径不允许 traversal: ${relativePath}`)
  }
  const abs = path.resolve(workspacePath, normalized)
  const root = path.resolve(workspacePath)
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error(`路径越界: ${relativePath}`)
  }
  return abs
}

async function assertSafePathChain(
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

async function walkAssetFiles(dir: string, baseDir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    await assertNotSymlinkOrJunction(abs)
    if (entry.isDirectory()) {
      await walkAssetFiles(abs, baseDir, out)
    } else if (entry.isFile()) {
      out.push(path.relative(baseDir, abs).replace(/\\/g, '/'))
    }
  }
}

export async function planPreviewAssetFiles(workspacePath: string): Promise<PreviewAssetFile[]> {
  const assetsSubdir = 'assets'
  let assetsRoot: string
  try {
    assetsRoot = await assertSafePathChain(workspacePath, assetsSubdir, { allowMissingSuffix: true })
    await fs.access(assetsRoot)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return []
    }
    throw err
  }

  const relFiles: string[] = []
  await walkAssetFiles(assetsRoot, assetsRoot, relFiles)
  relFiles.sort()

  const plans: PreviewAssetFile[] = []
  for (const rel of relFiles) {
    if (rel.split('/').some((part) => part === '..')) {
      throw new Error(`assets 路径不安全: ${rel}`)
    }
    const src = path.join(assetsRoot, rel)
    await assertNotSymlinkOrJunction(src)
    const content = await fs.readFile(src)
    plans.push({ relativePath: path.posix.join('assets', rel), content })
  }
  return plans
}
