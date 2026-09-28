import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeIsolatedDataRoot, startRemoteServer } from './test-harness.js'
import {
  initSiteRepository,
  manifestJsonForPublishedSite,
  pushBundleHttp,
  writeGitBundle,
} from './test-git-helpers.js'

const token = 'secret-token'

async function publishSiteViaBundle(input: {
  baseUrl: string
  dataRoot: string
  publicBodyMarker: string
  locale?: string
}): Promise<{ remoteSiteId: string; publishedCommitId: string; commitId: string }> {
  const createRes = await fetch(`${input.baseUrl}/api/remote/sites`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(createRes.status).toBe(200)
  const { remoteSiteId } = (await createRes.json()) as { remoteSiteId: string }
  const locale = input.locale ?? 'en'
  const settings = JSON.stringify({ defaultLocale: locale, locales: [locale] })
  const repoDir = path.join(input.dataRoot, 'r', remoteSiteId.slice(0, 8))
  const { commitId } = await initSiteRepository(repoDir, {
    'olps.manifest.json': await manifestJsonForPublishedSite(input.dataRoot),
    'source/site-settings.json': settings,
    'public/index.html': `<!DOCTYPE html><html><head><title>Locale:${locale}</title></head><body>${input.publicBodyMarker}</body></html>`,
  })
  const bundlePath = path.join(input.dataRoot, 'b', `${remoteSiteId.slice(0, 8)}.bundle`)
  await writeGitBundle(repoDir, bundlePath)
  const pushRes = await pushBundleHttp({
    baseUrl: input.baseUrl,
    token,
    remoteSiteId,
    bundlePath,
    commitId,
    expectedPublishedCommitId: null,
  })
  if (pushRes.status !== 200) {
    throw new Error(`push 失败 ${pushRes.status}: ${await pushRes.text()}`)
  }
  const body = (await pushRes.json()) as { publishedCommitId: string }
  expect(body.publishedCommitId).toBe(commitId)
  return { remoteSiteId, publishedCommitId: body.publishedCommitId, commitId }
}

describe('独立远端 HTTP 服务', () => {
  it('未携带 token 时拒绝创建站点', async () => {
    const dataRoot = await makeIsolatedDataRoot('auth')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const res = await fetch(`${baseUrl}/api/remote/sites`, { method: 'POST' })
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })

  it('未发布站点不得读取磁盘上预置的 public 目录', async () => {
    const dataRoot = await makeIsolatedDataRoot('unpublished')
    const siteId = '550e8400-e29b-41d4-a716-446655440088'
    await fs.mkdir(path.join(dataRoot, 'public', siteId), { recursive: true })
    await fs.writeFile(
      path.join(dataRoot, 'public', siteId, 'index.html'),
      '<html>must-not-serve</html>',
      'utf8',
    )
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const res = await fetch(`${baseUrl}/s/${siteId}/index.html`)
      expect(res.status).toBe(404)
    } finally {
      close()
    }
  })

  it('未知 remoteSiteId 公开访问返回 404', async () => {
    const dataRoot = await makeIsolatedDataRoot('unknown-site')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const res = await fetch(
        `${baseUrl}/s/550e8400-e29b-41d4-a716-446655440077/index.html`,
      )
      expect(res.status).toBe(404)
    } finally {
      close()
    }
  })

  it('真实发布后公开路由可读 public 且不可读 source 与 Git', async () => {
    const dataRoot = await makeIsolatedDataRoot('public-only')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const marker = 'published-marker-abc'
      const { remoteSiteId } = await publishSiteViaBundle({
        baseUrl,
        dataRoot,
        publicBodyMarker: marker,
      })
      const ok = await fetch(`${baseUrl}/s/${remoteSiteId}/index.html`)
      expect(ok.status).toBe(200)
      expect(await ok.text()).toContain(marker)
      const blockedSource = await fetch(
        `${baseUrl}/s/${remoteSiteId}/source/site-settings.json`,
      )
      expect(blockedSource.status).toBe(404)
      const blockedGit = await fetch(`${baseUrl}/s/${remoteSiteId}/.git/HEAD`)
      expect(blockedGit.status).toBe(404)
      const traversal = await fetch(
        `${baseUrl}/s/${remoteSiteId}/%2e%2e/%2e%2e/source/site-settings.json`,
      )
      expect(traversal.status).toBe(404)
    } finally {
      close()
    }
  })

  it('push 接受真实 Git bundle；非法 bundle 返回 400 且已发布页面不变', async () => {
    const dataRoot = await makeIsolatedDataRoot('push-format')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const stableMarker = 'stable-content-v1'
      const published = await publishSiteViaBundle({
        baseUrl,
        dataRoot,
        publicBodyMarker: stableMarker,
      })
      const pageBefore = await fetch(`${baseUrl}/s/${published.remoteSiteId}/index.html`)
      expect(await pageBefore.text()).toContain(stableMarker)

      const illegalBundlePath = path.join(dataRoot, 'tmp-bundles', 'illegal.bundle')
      await fs.mkdir(path.dirname(illegalBundlePath), { recursive: true })
      await fs.writeFile(illegalBundlePath, Buffer.from('not-a-git-bundle-at-all'))
      const badRes = await pushBundleHttp({
        baseUrl,
        token,
        remoteSiteId: published.remoteSiteId,
        bundlePath: illegalBundlePath,
        commitId: published.commitId,
        expectedPublishedCommitId: published.publishedCommitId,
      })
      expect(badRes.status).toBe(400)
      const pageAfter = await fetch(`${baseUrl}/s/${published.remoteSiteId}/index.html`)
      expect(pageAfter.status).toBe(200)
      expect(await pageAfter.text()).toContain(stableMarker)
    } finally {
      close()
    }
  })

  it('构建失败时 push 拒绝切换版本且公开内容保持上一成功发布', async () => {
    const dataRoot = await makeIsolatedDataRoot('deploy-fail')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const goodMarker = 'good-deploy'
      const published = await publishSiteViaBundle({
        baseUrl,
        dataRoot,
        publicBodyMarker: goodMarker,
      })
      const failManifest = JSON.stringify({
        version: 1,
        verifyCommand: [process.execPath, '-e', 'process.exit(9)'],
      })
      const repoDir = path.join(dataRoot, 'r', 'fail-next')
      const { commitId: failCommitId } = await initSiteRepository(repoDir, {
        'olps.manifest.json': failManifest,
        'source/site-settings.json': JSON.stringify({ defaultLocale: 'en', locales: ['en'] }),
        'public/index.html':
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>broken-deploy</body></html>',
      })
      const bundlePath = path.join(dataRoot, 'b', 'fail.bundle')
      await writeGitBundle(repoDir, bundlePath)
      const failPush = await pushBundleHttp({
        baseUrl,
        token,
        remoteSiteId: published.remoteSiteId,
        bundlePath,
        commitId: failCommitId,
        expectedPublishedCommitId: published.publishedCommitId,
      })
      expect(failPush.status).toBeGreaterThanOrEqual(400)
      expect(failPush.status).toBeLessThan(500)
      const pageAfter = await fetch(`${baseUrl}/s/${published.remoteSiteId}/index.html`)
      const pageText = await pageAfter.text()
      expect(pageText).toContain(goodMarker)
      expect(pageText).not.toContain('broken-deploy')
    } finally {
      close()
    }
  })
})
