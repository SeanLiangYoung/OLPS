import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { planAssetCopies } from './assets.js'
import { writePublicOutputs } from './write-public.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
let workspace: string | undefined

afterEach(async () => {
  if (workspace) await fs.rm(workspace, { recursive: true, force: true })
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
