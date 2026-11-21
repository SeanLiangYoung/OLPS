import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import * as esbuild from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeCssPortable } from './portable-html.js'
import type { SiteModel } from '@olps/render'
import { SITE_PATHS } from './paths.js'
import { assertNotSymlinkOrJunction, assertSafePathChain } from './path-guard.js'

export type BundledAssetFile = {
  relativePath: string
  content: Buffer
}

export type BundleResult = {
  files: BundledAssetFile[]
  /** 逻辑文件名 -> 带哈希的文件名，供 asset_url 与 HTML 改写 */
  assetHashes: Record<string, string>
  /** 未哈希路径 -> 带哈希的公开路径（以 / 开头） */
  publicPathRewrites: Record<string, string>
}

type ThemeManifest = {
  styles?: string[]
  scripts?: string[]
}

type PluginManifest = {
  assets?: string[]
}

function contentHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 10)
}

function hashedFileName(originalName: string, hash: string): string {
  const dot = originalName.lastIndexOf('.')
  if (dot < 0) {
    return `${originalName}.${hash}`
  }
  return `${originalName.slice(0, dot)}.${hash}${originalName.slice(dot)}`
}

async function readJson<T>(absPath: string): Promise<T> {
  return JSON.parse(await fs.readFile(absPath, 'utf8')) as T
}

async function bundleEntry(entryAbs: string, kind: 'css' | 'js', sourceAssetsRoot: string, publicAssetsPath: string): Promise<Buffer> {
  await assertNotSymlinkOrJunction(entryAbs)
  const result = await esbuild.build({
    entryPoints: [entryAbs],
    bundle: true,
    write: false,
    minify: true,
    platform: 'browser',
    external: ['/assets/*'],
    plugins: [{
      name: 'static-asset-urls',
      setup(build) {
        build.onResolve({ filter: /.*/ }, async args => {
          if (args.kind !== 'url-token' || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(args.path)) return undefined
          const url = new URL(args.path, pathToFileURL(args.resolveDir + path.sep))
          const target = fileURLToPath(url)
          const relative = path.relative(sourceAssetsRoot, target).replace(/\\/g, '/')
          await assertSafePathChain(sourceAssetsRoot, relative)
          return { path: `${publicAssetsPath}/${relative}${url.search}${url.hash}`, external: true }
        })
      },
    }],
    ...(kind === 'js' ? { format: 'iife' as const } : {}),
    logLevel: 'silent',
  })
  const output = result.outputFiles?.[0]
  if (!output) {
    throw new Error(`esbuild 未产出文件：${entryAbs}`)
  }
  return Buffer.from(output.contents)
}

function enabledPluginIds(model: SiteModel): string[] {
  return Object.entries(model.plugins.plugins)
    .filter(([, config]) => config.enabled)
    .map(([id]) => id)
}

function resolveTrackingRuntimePath(): string {
  const require = createRequire(import.meta.url)
  try {
    return require.resolve('@olps/tracking-runtime/olps-tracking.js')
  } catch {
    const packageRoot = path.dirname(fileURLToPath(import.meta.url))
    return path.resolve(packageRoot, '../../tracking-runtime/dist/olps-tracking.js')
  }
}

export async function bundleThemeAndPluginAssets(
  workspacePath: string,
  model: SiteModel,
): Promise<BundleResult> {
  const files: BundledAssetFile[] = []
  const assetHashes: Record<string, string> = {}
  const publicPathRewrites: Record<string, string> = {}

  const themeId = model.appearance.themeId
  const themeJsonAbs = await assertSafePathChain(
    workspacePath,
    path.posix.join(SITE_PATHS.themesDir, themeId, 'theme.json'),
  )
  const theme = await readJson<ThemeManifest>(themeJsonAbs)
  const styleEntries = theme.styles ?? []
  const scriptEntries = theme.scripts ?? []

  for (const entry of [...styleEntries, ...scriptEntries]) {
    const entryAbs = await assertSafePathChain(
      workspacePath,
      path.posix.join(SITE_PATHS.themesDir, themeId, entry),
    )
    const baseName = path.posix.basename(entry)
    const kind = entry.endsWith('.css') ? 'css' : 'js'
    const raw = await bundleEntry(entryAbs, kind, path.join(workspacePath, 'themes', themeId, 'assets'), `/assets/theme/${themeId}`)
    const bytes = kind === 'css' ? Buffer.from(makeCssPortable(raw.toString('utf8'), `assets/theme/${themeId}/${baseName}`)) : raw
    const hashed = hashedFileName(baseName, contentHash(bytes))
    assetHashes[baseName] = hashed
    const publicRel = path.posix.join(
      SITE_PATHS.publicDir,
      'assets',
      'theme',
      themeId,
      hashed,
    )
    files.push({ relativePath: publicRel, content: bytes })
    publicPathRewrites[`/assets/theme/${themeId}/${baseName}`] = `/assets/theme/${themeId}/${hashed}`
  }

  for (const pluginId of enabledPluginIds(model)) {
    const pluginJsonAbs = await assertSafePathChain(
      workspacePath,
      path.posix.join(SITE_PATHS.pluginsDir, pluginId, 'plugin.json'),
    )
    const plugin = await readJson<PluginManifest>(pluginJsonAbs)
    for (const entry of plugin.assets ?? []) {
      const entryAbs = await assertSafePathChain(
        workspacePath,
        path.posix.join(SITE_PATHS.pluginsDir, pluginId, entry),
      )
      const baseName = path.posix.basename(entry)
      const kind = entry.endsWith('.css') ? 'css' : 'js'
      const raw = await bundleEntry(entryAbs, kind, path.join(workspacePath, 'plugins', pluginId, 'assets'), `/assets/plugin/${pluginId}`)
      const bytes = kind === 'css' ? Buffer.from(makeCssPortable(raw.toString('utf8'), `assets/plugin/${pluginId}/${baseName}`)) : raw
      const hashed = hashedFileName(baseName, contentHash(bytes))
      const publicRel = path.posix.join(
        SITE_PATHS.publicDir,
        'assets',
        'plugin',
        pluginId,
        hashed,
      )
      files.push({ relativePath: publicRel, content: bytes })
      publicPathRewrites[`/assets/plugin/${pluginId}/${baseName}`] =
        `/assets/plugin/${pluginId}/${hashed}`
    }
  }

  const trackingSource = resolveTrackingRuntimePath()
  const trackingBytes = await fs.readFile(trackingSource)
  files.push({
    relativePath: path.posix.join(SITE_PATHS.publicDir, 'olps-tracking.js'),
    content: trackingBytes,
  })

  return { files, assetHashes, publicPathRewrites }
}

export function rewriteHashedAssetPaths(
  html: string,
  publicPathRewrites: Record<string, string>,
): string {
  let result = html
  for (const [from, to] of Object.entries(publicPathRewrites)) {
    result = result.split(from).join(to)
  }
  return result
}
