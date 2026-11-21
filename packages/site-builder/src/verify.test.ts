import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { installSiteBuilder } from './install.js'
import { recordBuildVerification, verifySite } from './verify.js'

let workspace = ''
afterEach(async () => { if (workspace) await fs.rm(workspace, { recursive: true, force: true }) })

async function createWorkspace(): Promise<string> {
  const parent = path.resolve('../../.intermediate/verify-tests')
  await fs.mkdir(parent, { recursive: true })
  workspace = await fs.mkdtemp(path.join(parent, 'run-'))
  await fs.mkdir(path.join(workspace, 'public'))
  await fs.mkdir(path.join(workspace, 'source'))
  await fs.writeFile(path.join(workspace, 'source/publish-config.json'), JSON.stringify({ publicApiBaseUrl: 'https://api.example.com/public' }))
  await fs.writeFile(path.join(workspace, 'olps.manifest.json'), JSON.stringify({ schemaVersion: 1 }))
  return workspace
}

it.each([
  ['style.css', 'body{background:url("missing.png")}', '失效地址'],
  ['index.html', '<img srcset="existing.svg 1x, missing.png 2x">', '失效地址'],
  ['index.html', '<style>body{background:url(missing.png)}</style>', '失效地址'],
  ['index.html', '<a href="https://example.com/api/drafts/abc/editor-resources/image.png">内容</a>', '内部地址'],
  ['index.php', '<?php echo 1;', '服务器脚本'],
])('拒绝 %s 中的无效内容', async (name, content, message) => {
  await createWorkspace()
  await fs.writeFile(path.join(workspace, 'public/existing.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')
  await fs.writeFile(path.join(workspace, 'public', name), content)
  await recordBuildVerification(workspace)
  await expect(verifySite(workspace)).rejects.toThrow(message)
})

it('允许公开 API 地址并拒绝相同前缀的其他地址', async () => {
  await createWorkspace()
  await fs.writeFile(path.join(workspace, 'public/index.html'), '<form action="https://api.example.com/public/inquiries"></form>')
  await recordBuildVerification(workspace)
  await verifySite(workspace)
  await fs.writeFile(path.join(workspace, 'public/index.html'), '<img src="https://api.example.com/api/drafts/x/editor-resources/image.png">')
  await recordBuildVerification(workspace)
  await expect(verifySite(workspace)).rejects.toThrow('内部地址')
})

it.each(['https://www.example.com/', 'https://www.example.com/company/'])('检查 %s 的本站绝对地址', async (siteUrl) => {
  await createWorkspace()
  await fs.writeFile(path.join(workspace, 'source/site-settings.json'), JSON.stringify({ siteUrl }))
  const asset = new URL('logo.svg', siteUrl).href
  await fs.writeFile(path.join(workspace, 'public/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await fs.writeFile(path.join(workspace, 'public/index.html'), `<base href="${siteUrl}"><link rel="canonical" href="${siteUrl}"><img src="${asset}">`)
  await recordBuildVerification(workspace)
  await verifySite(workspace)
  await fs.writeFile(path.join(workspace, 'public/index.html'), `<link rel="alternate" hreflang="en" href="${new URL('missing/', siteUrl).href}">`)
  await recordBuildVerification(workspace)
  await expect(verifySite(workspace)).rejects.toThrow('失效地址')
})

it('构建摘要忽略键顺序并拒绝缺少目录记录的摘要', async () => {
  await createWorkspace()
  await fs.writeFile(path.join(workspace, 'public/index.html'), '<p>页面</p>')
  await fs.writeFile(path.join(workspace, 'public/a.txt'), '内容')
  await recordBuildVerification(workspace)
  const file = path.join(workspace, '.olps-build.json')
  const recorded = JSON.parse(await fs.readFile(file, 'utf8'))
  recorded.public = Object.fromEntries(Object.entries(recorded.public).reverse())
  await fs.writeFile(file, JSON.stringify(recorded))
  await verifySite(workspace)
  delete recorded.source
  await fs.writeFile(file, JSON.stringify(recorded))
  await expect(verifySite(workspace)).rejects.toThrow('格式无效')
})

it('检查 tools 和网站 manifest 的变化', async () => {
  await createWorkspace()
  await fs.writeFile(path.join(workspace, 'public/index.html'), '<p>页面</p>')
  await recordBuildVerification(workspace)
  await fs.writeFile(path.join(workspace, 'olps.manifest.json'), JSON.stringify({ schemaVersion: 2 }))
  await expect(verifySite(workspace)).rejects.toThrow('不一致')
})

it.each(['新增', '删除', '源码'])('检查%s文件后的摘要变化', async (change) => {
  await createWorkspace()
  await fs.writeFile(path.join(workspace, 'public/index.html'), '<p>页面</p>')
  await recordBuildVerification(workspace)
  if (change === '新增') await fs.writeFile(path.join(workspace, 'public/new.txt'), 'content')
  if (change === '删除') await fs.rm(path.join(workspace, 'public/index.html'))
  if (change === '源码') await fs.writeFile(path.join(workspace, 'source/new.json'), '{}')
  await expect(verifySite(workspace)).rejects.toThrow('不一致')
})

it('在不含 node_modules 的目录执行独立验证程序', async () => {
  await createWorkspace()
  await fs.writeFile(path.join(workspace, 'public/index.html'), '<p>页面</p>')
  await installSiteBuilder(workspace)
  await recordBuildVerification(workspace)
  const result = await promisify(execFile)(process.execPath, ['tools/site-verify.mjs'], { cwd: workspace })
  expect(result.stderr).toBe('')
  await fs.writeFile(path.join(workspace, 'public/new.txt'), 'content')
  await expect(promisify(execFile)(process.execPath, ['tools/site-verify.mjs'], { cwd: workspace })).rejects.toThrow('不一致')
})

it('检查构建摘要和页面链接', async () => {
  const parent = path.resolve('../../.intermediate/verify-tests')
  await fs.mkdir(parent, { recursive: true })
  workspace = await fs.mkdtemp(path.join(parent, 'run-'))
  await fs.mkdir(path.join(workspace, 'public'))
  await fs.writeFile(path.join(workspace, 'public/index.html'), '<a href="./">首页</a>')
  await recordBuildVerification(workspace)
  await verifySite(workspace)
  await fs.writeFile(path.join(workspace, 'public/index.html'), '<a href="missing/">内容</a>')
  await expect(verifySite(workspace)).rejects.toThrow('失效地址')
  await fs.writeFile(path.join(workspace, 'public/index.html'), '<p>修改</p>')
  await expect(verifySite(workspace)).rejects.toThrow('不一致')
})
