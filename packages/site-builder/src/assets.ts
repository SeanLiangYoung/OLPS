import fs from 'node:fs/promises'
import path from 'node:path'
import { assertNotSymlinkOrJunction, assertSafePathChain } from './path-guard.js'
import { SITE_PATHS } from './paths.js'

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
      if (entry.name === '.gitkeep') {
        continue
      }
      out.push(path.relative(baseDir, abs).replace(/\\/g, '/'))
    }
  }
}

async function copyTreeUnder(
  workspacePath: string,
  sourceRelative: string,
  publicPrefix: string,
): Promise<AssetCopyPlan[]> {
  let root: string
  try {
    root = await assertSafePathChain(workspacePath, sourceRelative, { allowMissingSuffix: true })
    await fs.access(root)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return []
    }
    throw error
  }

  const relFiles: string[] = []
  await walkFiles(root, root, relFiles)
  relFiles.sort()

  const plans: AssetCopyPlan[] = []
  for (const rel of relFiles) {
    if (rel.split('/').some((part) => part === '..')) {
      throw new Error(`资源路径不安全：${sourceRelative}/${rel}`)
    }
    // CSS/JS 由 bundles 处理，这里跳过主题与插件的可打包前端入口
    if (
      (sourceRelative.startsWith('themes/') || sourceRelative.startsWith('plugins/'))
      && (rel.startsWith('assets/') && (rel.endsWith('.css') || rel.endsWith('.js')))
    ) {
      continue
    }
    const src = path.join(root, rel)
    await assertNotSymlinkOrJunction(src)
    const content = await fs.readFile(src)
    plans.push({
      relativePath: path.posix.join(SITE_PATHS.publicDir, publicPrefix, rel),
      content,
    })
  }
  return plans
}

export async function planAssetCopies(
  workspacePath: string,
  options: {
    themeId: string
    enabledPluginIds: string[]
  },
): Promise<AssetCopyPlan[]> {
  const plans: AssetCopyPlan[] = []

  plans.push(
    ...(await copyTreeUnder(workspacePath, SITE_PATHS.uploadsDir, SITE_PATHS.uploadsDir)),
  )

  // 主题非 CSS/JS 静态文件（字体、图片等）
  plans.push(
    ...(await copyTreeUnder(
      workspacePath,
      path.posix.join(SITE_PATHS.themesDir, options.themeId, 'assets'),
      path.posix.join('themes', options.themeId, 'assets'),
    )),
  )

  for (const pluginId of options.enabledPluginIds) {
    plans.push(
      ...(await copyTreeUnder(
        workspacePath,
        path.posix.join(SITE_PATHS.pluginsDir, pluginId, 'assets'),
        path.posix.join('plugins', pluginId, 'assets'),
      )),
    )
  }

  return plans
}
