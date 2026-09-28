import fs from 'node:fs/promises'
import path from 'node:path'
import { assertNotSymlinkOrJunction, assertSafePathChain } from './path-guard.js'
import { ASSETS_SUBDIR, PUBLIC_DIR } from './paths.js'

export type AssetCopyPlan = {
  relativePath: string
  content: Buffer
}

async function walkFiles(dir: string, baseDir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    await assertNotSymlinkOrJunction(abs)
    if (entry.isDirectory()) {
      await walkFiles(abs, baseDir, out)
    } else if (entry.isFile()) {
      out.push(path.relative(baseDir, abs).replace(/\\/g, '/'))
    }
  }
}

export async function planAssetCopies(workspacePath: string): Promise<AssetCopyPlan[]> {
  let assetsRoot: string
  try {
    assetsRoot = await assertSafePathChain(workspacePath, ASSETS_SUBDIR, { allowMissingSuffix: true })
    await fs.access(assetsRoot)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return []
    }
    throw err
  }

  let relFiles: string[] = []
  await walkFiles(assetsRoot, assetsRoot, relFiles)

  relFiles.sort()
  const plans: AssetCopyPlan[] = []
  for (const rel of relFiles) {
    if (rel.split('/').some((part) => part === '..')) {
      throw new Error(`assets 路径不安全: ${rel}`)
    }
    const src = path.join(assetsRoot, rel)
    await assertNotSymlinkOrJunction(src)
    const content = await fs.readFile(src)
    plans.push({ relativePath: path.posix.join(PUBLIC_DIR, 'assets', rel), content })
  }
  return plans
}
