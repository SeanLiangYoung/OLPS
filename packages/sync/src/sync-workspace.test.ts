import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import {
  publicHtmlFromSettings,
  sandboxRoot,
  siteBuildConfig,
  siteManifestWithVerify,
  siteNoopBuildWithVerify,
} from './test-helpers.js'

const dummyRemote = { baseUrl: 'http://127.0.0.1:9', token: 'test-token-unused' }

describe('SyncWorkspace 本地 Git 工作目录', () => {
  it('create 初始化含 manifest、source、public 的 Git 仓库并产生 headCommitId', async () => {
    const root = await sandboxRoot('create')
    const draftId = 'draft-create-1'
    const ws = await SyncWorkspace.create({
      sandboxRoot: root,
      draftId,
      remote: dummyRemote,
    })
    const state = ws.getState()
    expect(state.draftId).toBe(draftId)
    expect(state.headCommitId).toMatch(/^[0-9a-f]{40}$/)
    expect(state.status).toBe('clean')
    const manifest = await fs.readFile(
      path.join(state.workspacePath, SITE_PATHS.manifest),
      'utf8',
    )
    expect(JSON.parse(manifest).schemaVersion).toBe(1)
    expect(JSON.parse(manifest)).not.toHaveProperty('buildCommand')
    await fs.access(path.join(state.workspacePath, SITE_PATHS.siteSettings))
    await fs.access(path.join(state.workspacePath, SITE_PATHS.publicDir))
  })

  it('writeFile 与 readFile 支持二进制 assets', async () => {
    const root = await sandboxRoot('binary')
    const ws = await SyncWorkspace.create({
      sandboxRoot: root,
      draftId: 'draft-binary',
      remote: dummyRemote,
    })
    const payload = Buffer.from([0, 255, 127, 1])
    const rel = `${SITE_PATHS.assetsDir}/logo.bin`
    await ws.writeFile(rel, payload)
    const round = await ws.readFile(rel)
    expect(Buffer.compare(round, payload)).toBe(0)
    const saved = await ws.saveVersion('test: binary asset')
    expect(saved.headCommitId).toMatch(/^[0-9a-f]{40}$/)
  })

  it('writeFile 拒绝路径穿越、.git 与符号链接指向仓库外', async () => {
    const root = await sandboxRoot('traversal')
    const ws = await SyncWorkspace.create({
      sandboxRoot: root,
      draftId: 'draft-traversal',
      remote: dummyRemote,
    })
    await expect(ws.writeFile('../outside.txt', Buffer.from('x'))).rejects.toThrow(/路径/)
    await expect(ws.writeFile('.git/config', Buffer.from('x'))).rejects.toThrow(/路径|\.git/)
    const state = ws.getState()
    const secretFile = path.join(root, 'outside-secret.txt')
    await fs.writeFile(secretFile, 'secret-data', 'utf8')
    const linkPath = path.join(state.workspacePath, SITE_PATHS.assetsDir, 'escape-link')
    await fs.mkdir(path.dirname(linkPath), { recursive: true })
    let symlinkOk = true
    try {
      await fs.symlink(secretFile, linkPath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM' && process.platform === 'win32') {
        symlinkOk = false
      } else {
        throw err
      }
    }
    if (symlinkOk) {
      await expect(ws.readFile(`${SITE_PATHS.assetsDir}/escape-link`)).rejects.toThrow(
        /符号|symlink|路径/,
      )
    }
  })

  it('saveVersion 后 status 为 clean，未保存修改为 dirty', async () => {
    const root = await sandboxRoot('dirty')
    const ws = await SyncWorkspace.create({
      sandboxRoot: root,
      draftId: 'draft-dirty',
      remote: dummyRemote,
    })
    await ws.writeFile(`${SITE_PATHS.publicDir}/index.html`, Buffer.from('<html></html>'))
    expect(ws.getState().status).toBe('dirty')
    await ws.saveVersion('pages: index')
    expect(ws.getState().status).toBe('clean')
  })

  it('runValidation 在 HTML 与 JSON 不一致时 validation_failed', async () => {
    const root = await sandboxRoot('validate-fail')
    const ws = await SyncWorkspace.create({
      sandboxRoot: root,
      draftId: 'draft-validate-fail',
      remote: dummyRemote,
      build: siteNoopBuildWithVerify(),
    })
    const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
    await ws.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
    await ws.writeFile(SITE_PATHS.siteSettings, Buffer.from(settings, 'utf8'))
    await ws.writeFile(
      `${SITE_PATHS.publicDir}/index.html`,
      Buffer.from('<html><head><title>Locale:de</title></head></html>', 'utf8'),
    )
    const result = await ws.runValidation()
    expect(result.ok).toBe(false)
    expect(result.status).toBe('validation_failed')
  })

  it('runValidation 在 HTML 与 JSON 一致时通过', async () => {
    const root = await sandboxRoot('validate-ok')
    const ws = await SyncWorkspace.create({
      sandboxRoot: root,
      draftId: 'draft-validate-ok',
      remote: dummyRemote,
      build: siteBuildConfig(),
    })
    const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
    await ws.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
    await ws.writeFile(SITE_PATHS.siteSettings, Buffer.from(settings, 'utf8'))
    await ws.writeFile(
      `${SITE_PATHS.publicDir}/index.html`,
      Buffer.from(publicHtmlFromSettings(settings), 'utf8'),
    )
    const result = await ws.runValidation()
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('clean')
  })
})
