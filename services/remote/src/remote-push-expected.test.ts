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

describe('expectedPublishedCommitId 严格比较', () => {
  it('已发布站点在 expected 为空 header 时返回 409', async () => {
    const dataRoot = await makeIsolatedDataRoot('expected-null')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const createRes = await fetch(`${baseUrl}/api/remote/sites`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const { remoteSiteId } = (await createRes.json()) as { remoteSiteId: string }
      const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const manifest = await manifestJsonForPublishedSite(dataRoot)
      const repoDir = path.join(dataRoot, 'r', 'v1')
      const { commitId } = await initSiteRepository(repoDir, {
        'olps.manifest.json': manifest,
        'source/site-settings.json': settings,
        'public/index.html':
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>v1</body></html>',
      })
      const bundlePath = path.join(dataRoot, 'b', 'v1.bundle')
      await writeGitBundle(repoDir, bundlePath)
      const first = await pushBundleHttp({
        baseUrl,
        token,
        remoteSiteId,
        bundlePath,
        commitId,
        expectedPublishedCommitId: null,
      })
      expect(first.status).toBe(200)

      const repo2 = path.join(dataRoot, 'r', 'v2')
      const { commitId: c2 } = await initSiteRepository(repo2, {
        'olps.manifest.json': manifest,
        'source/site-settings.json': settings,
        'public/index.html':
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>v2</body></html>',
      })
      const b2 = path.join(dataRoot, 'b', 'v2.bundle')
      await writeGitBundle(repo2, b2)
      const stale = await pushBundleHttp({
        baseUrl,
        token,
        remoteSiteId,
        bundlePath: b2,
        commitId: c2,
        expectedPublishedCommitId: null,
      })
      expect(stale.status).toBe(409)
      const page = await fetch(`${baseUrl}/s/${remoteSiteId}/index.html`)
      expect(await page.text()).toContain('v1')
    } finally {
      close()
    }
  })

  it('两个同时首次 null 提交仅一个成功', async () => {
    const dataRoot = await makeIsolatedDataRoot('race-null')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const createRes = await fetch(`${baseUrl}/api/remote/sites`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const { remoteSiteId } = (await createRes.json()) as { remoteSiteId: string }
      const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const manifest = await manifestJsonForPublishedSite(dataRoot)
      async function bundleWithMarker(marker: string): Promise<{
        bundlePath: string
        commitId: string
      }> {
        const repoDir = path.join(dataRoot, 'r', marker)
        const { commitId } = await initSiteRepository(repoDir, {
          'olps.manifest.json': manifest,
          'source/site-settings.json': settings,
          'public/index.html': `<!DOCTYPE html><html><head><title>Locale:en</title></head><body>${marker}</body></html>`,
        })
        const bundlePath = path.join(dataRoot, 'b', `${marker}.bundle`)
        await writeGitBundle(repoDir, bundlePath)
        return { bundlePath, commitId }
      }
      const a = await bundleWithMarker('race-a')
      const b = await bundleWithMarker('race-b')
      const [r1, r2] = await Promise.all([
        pushBundleHttp({
          baseUrl,
          token,
          remoteSiteId,
          bundlePath: a.bundlePath,
          commitId: a.commitId,
          expectedPublishedCommitId: null,
        }),
        pushBundleHttp({
          baseUrl,
          token,
          remoteSiteId,
          bundlePath: b.bundlePath,
          commitId: b.commitId,
          expectedPublishedCommitId: null,
        }),
      ])
      const okCount = [r1.status, r2.status].filter((s) => s === 200).length
      const conflictCount = [r1.status, r2.status].filter((s) => s === 409).length
      expect(okCount).toBe(1)
      expect(conflictCount).toBe(1)
    } finally {
      close()
    }
  })
})
