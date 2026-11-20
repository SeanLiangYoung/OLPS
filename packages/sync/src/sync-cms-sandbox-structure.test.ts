import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import {
  publicHtmlFromSettings,
  sandboxRoot,
  siteBuildConfig,
  siteManifestWithVerify,
} from './test-helpers.js'
import {
  makeIsolatedDataRoot,
  startRemoteServer,
} from '../../../services/remote/src/test-harness.js'

const dummyRemote = { baseUrl: 'http://127.0.0.1:9', token: 'test-token-unused' }

const REQUIRED_DIRS = [
  SITE_PATHS.pagesDir,
  SITE_PATHS.collectionsDir,
  SITE_PATHS.mediaDir,
  SITE_PATHS.i18nDir,
  SITE_PATHS.uploadsDir,
  SITE_PATHS.themesDir,
  SITE_PATHS.pluginsDir,
  SITE_PATHS.serverConfigDir,
  SITE_PATHS.publicDir,
  SITE_PATHS.cacheDir,
] as const

const REQUIRED_FILES = [
  SITE_PATHS.manifest,
  SITE_PATHS.siteSettings,
  SITE_PATHS.appearance,
  SITE_PATHS.pluginsConfig,
  SITE_PATHS.publishConfig,
  SITE_PATHS.redirects,
  SITE_PATHS.siteVerify,
  '.gitignore',
  '.gitattributes',
] as const

function binaryWithCrlfTrap(tag: string): Buffer {
  return Buffer.concat([
    Buffer.from(tag, 'utf8'),
    Buffer.from([0x00, 0x0d, 0x0a, 0x1a, 0xff, 0x0d, 0x0a, 0x7f]),
    Buffer.from(tag.split('').reverse().join(''), 'utf8'),
  ])
}

async function assertBinaryRoundTrip(
  relativePath: string,
  payload: Buffer,
): Promise<void> {
  const dataRoot = await makeIsolatedDataRoot(`bin-${path.basename(relativePath)}`)
  const { baseUrl, close } = await startRemoteServer({
    dataRoot,
    serviceToken: 'remote-test-token',
    publicBaseUrl: 'http://127.0.0.1:0',
  })
  try {
    const remote = { baseUrl, token: 'remote-test-token' }
    const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
    const build = siteBuildConfig()
    const ws = await SyncWorkspace.create({
      sandboxRoot: await sandboxRoot(`bin-push-${path.extname(relativePath).slice(1)}`),
      draftId: 'draft-bin-push',
      remote,
      build,
    })
    await ws.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
    await ws.writeFile(SITE_PATHS.siteSettings, Buffer.from(settings, 'utf8'))
    await ws.writeFile(
      `${SITE_PATHS.publicDir}/index.html`,
      Buffer.from(publicHtmlFromSettings(settings), 'utf8'),
    )
    await ws.writeFile(relativePath, payload)
    const localRead = await ws.readFile(relativePath)
    expect(Buffer.compare(localRead, payload)).toBe(0)
    await ws.saveVersion(`binary: ${relativePath}`)
    const pushed = await ws.push({ expectedPublishedCommitId: null })

    const wsPull = await SyncWorkspace.create({
      sandboxRoot: await sandboxRoot(`bin-pull-${path.extname(relativePath).slice(1)}`),
      draftId: 'draft-bin-pull',
      remote,
      remoteSiteId: pushed.remoteSiteId,
      baseCommitId: pushed.publishedCommitId,
      build,
    })
    const pulled = await wsPull.readFile(relativePath)
    expect(Buffer.compare(pulled, payload)).toBe(0)
  } finally {
    close()
  }
}

describe('CMS sandbox 目录与二进制传输', () => {
  it('新建 sandbox 目录结构完整', async () => {
    const root = await sandboxRoot('cms-structure')
    const ws = await SyncWorkspace.create({
      sandboxRoot: root,
      draftId: 'draft-cms-structure',
      remote: dummyRemote,
      build: siteBuildConfig(),
    })
    const workspacePath = ws.getState().workspacePath
    for (const dir of REQUIRED_DIRS) {
      const stat = await fs.stat(path.join(workspacePath, dir))
      expect(stat.isDirectory()).toBe(true)
    }
    for (const file of REQUIRED_FILES) {
      await fs.access(path.join(workspacePath, file))
    }
    const manifest = JSON.parse(
      await fs.readFile(path.join(workspacePath, SITE_PATHS.manifest), 'utf8'),
    ) as Record<string, unknown>
    expect(manifest.schemaVersion).toBe(1)
    expect(Array.isArray(manifest.verifyCommand)).toBe(true)
    expect(manifest).not.toHaveProperty('buildCommand')
    expect(manifest).not.toHaveProperty('version')
    const gitignore = await fs.readFile(path.join(workspacePath, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.olps-cache/')
    const gitattributes = await fs.readFile(
      path.join(workspacePath, '.gitattributes'),
      'utf8',
    )
    expect(gitattributes).toMatch(/\.png\s+binary/)
    expect(gitattributes).toMatch(/\.woff2\s+binary/)
    expect(gitattributes).toMatch(/\.mp4\s+binary/)
    expect(gitattributes).toMatch(/\.pdf\s+binary/)
  })

  it('缺少 buildCommand 时校验失败', async () => {
    const ws = await SyncWorkspace.create({
      sandboxRoot: await sandboxRoot('cms-missing-build'),
      draftId: 'draft-cms-missing-build',
      remote: dummyRemote,
    })
    await expect(ws.runValidation()).rejects.toThrow(/buildCommand/)
  })

  it('PNG 字节不变', async () => {
    const payload = binaryWithCrlfTrap('PNG-HEAD')
    await assertBinaryRoundTrip(`${SITE_PATHS.uploadsDir}/sample.png`, payload)
  })

  it('WOFF2 字节不变', async () => {
    const payload = binaryWithCrlfTrap('WOFF2-HEAD')
    await assertBinaryRoundTrip(`${SITE_PATHS.uploadsDir}/sample.woff2`, payload)
  })

  it('MP4 字节不变', async () => {
    const payload = binaryWithCrlfTrap('MP4-HEAD')
    await assertBinaryRoundTrip(`${SITE_PATHS.uploadsDir}/sample.mp4`, payload)
  })

  it('PDF 字节不变', async () => {
    const payload = binaryWithCrlfTrap('PDF-HEAD')
    await assertBinaryRoundTrip(`${SITE_PATHS.uploadsDir}/sample.pdf`, payload)
  })
})
