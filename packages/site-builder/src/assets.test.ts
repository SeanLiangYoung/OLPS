import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { planAssetCopies } from './assets.js'
import { writePublicOutputs } from './write-public.js'
import { bundleThemeAndPluginAssets } from './bundles.js'
import { loadSiteModel } from '@olps/render'
import { createFsSourceReader } from './load.js'
import { createHash } from 'node:crypto'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
let workspace: string | undefined

afterEach(async () => {
  if (workspace) await fs.rm(workspace, { recursive: true, force: true })
})

it('主题 CSS 本地图片与根路径媒体地址可在子目录使用，文件名摘要匹配最终内容', async () => {
  const parent = path.join(repoRoot, '.intermediate', 'asset-copy-tests')
  await fs.mkdir(parent, { recursive: true })
  workspace = await fs.mkdtemp(path.join(parent, 'css-'))
  await fs.mkdir(path.join(workspace, 'themes/starter/assets/images'), { recursive: true })
  await fs.writeFile(path.join(workspace, 'themes/starter/theme.json'), JSON.stringify({ styles: ['assets/style.css'], scripts: [] }))
  await fs.writeFile(path.join(workspace, 'themes/starter/assets/style.css'), 'body{background:url(images/logo.svg)}main{background:url(/assets/uploads/banner.png)}')
  await fs.writeFile(path.join(workspace, 'themes/starter/assets/images/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const model = await loadSiteModel(createFsSourceReader(path.join(repoRoot, 'packages/render/test-fixtures/sites/full-site')))
  model.plugins.plugins = {}
  const result = await bundleThemeAndPluginAssets(workspace, model)
  const css = result.files.find(file => file.relativePath.endsWith('.css'))!
  expect(css.content.toString()).toContain('images/logo.svg')
  expect(css.content.toString()).toContain('../../uploads/banner.png')
  expect(css.content.toString()).not.toContain('url(/assets/')
  const digest = createHash('sha256').update(css.content).digest('hex').slice(0, 10)
  expect(css.relativePath).toContain(`.${digest}.css`)
})

it('主题与插件图片写入公开资源地址对应的文件', async () => {
  const parent = path.join(repoRoot, '.intermediate', 'asset-copy-tests')
  await fs.mkdir(parent, { recursive: true })
  workspace = await fs.mkdtemp(path.join(parent, 'paths-'))
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="blue"/></svg>'
  for (const directory of ['themes/starter/assets', 'plugins/example/assets']) {
    await fs.mkdir(path.join(workspace, directory), { recursive: true })
    await fs.writeFile(path.join(workspace, directory, 'logo.svg'), svg)
  }
  const files = await planAssetCopies(workspace, { themeId: 'starter', enabledPluginIds: ['example'] })
  await writePublicOutputs(workspace, files)
  for (const relative of ['assets/theme/starter/logo.svg', 'assets/plugin/example/logo.svg']) {
    expect(await fs.readFile(path.join(workspace, 'public', relative), 'utf8')).toBe(svg)
  }
})
