import fs from 'node:fs/promises'
import { favicons } from 'favicons'
import type { SiteModel } from '@olps/render'
import { assertSafePathChain } from './path-guard.js'
import type { OutputFile } from './types.js'

export async function planSiteIcons(workspacePath: string, model: SiteModel): Promise<OutputFile[]> {
  const id = model.settings.iconMediaId
  if (!id) return []
  const media = model.media.find(candidate => candidate.mediaId === id)
  if (!media) throw new Error(`网站图标媒体不存在：${id}`)
  const source = await fs.readFile(await assertSafePathChain(workspacePath, media.path))
  const result = await favicons(source, {
    appName: model.settings.siteName,
    appShortName: model.settings.siteName,
    appDescription: model.settings.company.name,
    lang: model.settings.defaultLocale,
    start_url: './',
    icons: { android: true, appleIcon: true, appleStartup: false, favicons: true, windows: false, yandex: false },
  })
  const publicPath = (name: string): string => ['favicon.ico', 'apple-touch-icon.png'].includes(name) ? name : `icons/${name}`
  const files: OutputFile[] = result.images.map(image => ({ relativePath: publicPath(image.name), content: image.contents }))
  const generatedManifest = result.files.find(file => file.name === 'manifest.webmanifest')
  if (!generatedManifest) throw new Error('图标生成器缺少 manifest.webmanifest')
  const manifest = JSON.parse(generatedManifest.contents) as { icons: Array<{ src: string }> }
  for (const icon of manifest.icons) icon.src = publicPath(icon.src.replace(/^\//, ''))
  files.push({ relativePath: 'manifest.webmanifest', content: `${JSON.stringify(manifest, null, 2)}\n` })
  return files
}
