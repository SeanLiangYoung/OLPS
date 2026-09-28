import fs from 'node:fs/promises'
import path from 'node:path'
import { ASSETS_SUBDIR, PUBLIC_DIR, assertNotSymlink, resolveInsideWorkspace } from './paths.js'

export type AssetCopyPlan = {
  relativePath: string
  content: Buffer
}

async function walkFiles(dir: string, baseDir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    await assertNotSymlink(abs)
    if (entry.isDirectory()) {
      await walkFiles(abs, baseDir, out)
    } else if (entry.isFile()) {
      out.push(path.relative(baseDir, abs).replace(/\\/g, '/'))
    }
  }
}

export async function planAssetCopies(workspacePath: string): Promise<AssetCopyPlan[]> {
  const assetsRoot = resolveInsideWorkspace(workspacePath, ASSETS_SUBDIR)
  let relFiles: string[] = []
  try {
    await assertNotSymlink(assetsRoot)
    await walkFiles(assetsRoot, assetsRoot, relFiles)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return []
    }
    throw err
  }

  relFiles.sort()
  const plans: AssetCopyPlan[] = []
  for (const rel of relFiles) {
    if (rel.split('/').some((part) => part === '..')) {
      throw new Error(`assets 路径不安全: ${rel}`)
    }
    const src = path.join(assetsRoot, rel)
    await assertNotSymlink(src)
    const content = await fs.readFile(src)
    plans.push({ relativePath: path.posix.join(PUBLIC_DIR, 'assets', rel), content })
  }
  return plans
}
