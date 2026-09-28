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

const token = 'remote-test-token'

const SETTINGS = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
const ROOT_HTML =
  '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>root</body></html>'
const SLUG_HTML =
  '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>slug-page</body></html>'
const CSS_BODY = 'body{color:blue}'

describe('公开目录 index.html 路由', () => {
  it('/s/:id/slug/、/s/:id/slug/index.html 与静态资源可访问', async () => {
    const dataRoot = await makeIsolatedDataRoot('public-dir')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const manifest = await manifestJsonForPublishedSite(dataRoot)
      const createRes = await fetch(`${baseUrl}/api/remote/sites`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const { remoteSiteId } = (await createRes.json()) as { remoteSiteId: string }
      const repoDir = path.join(dataRoot, 'r', 'dir-site')
      const { commitId } = await initSiteRepository(repoDir, {
        'olps.manifest.json': manifest,
        'source/site-settings.json': SETTINGS,
        'public/index.html': ROOT_HTML,
        'public/release-page/index.html': SLUG_HTML,
        'public/release-page/assets/site.css': CSS_BODY,
      })
      const bundlePath = path.join(dataRoot, 'b', 'dir.bundle')
      await writeGitBundle(repoDir, bundlePath)
      const pushRes = await pushBundleHttp({
        baseUrl,
        token,
        remoteSiteId,
        bundlePath,
        commitId,
        expectedPublishedCommitId: null,
      })
      expect(pushRes.status).toBe(200)

      const slugSlash = await fetch(`${baseUrl}/s/${remoteSiteId}/release-page/`)
      expect(slugSlash.status).toBe(200)
      expect(await slugSlash.text()).toBe(SLUG_HTML)

      const slugIndex = await fetch(`${baseUrl}/s/${remoteSiteId}/release-page/index.html`)
      expect(slugIndex.status).toBe(200)
      expect(await slugIndex.text()).toBe(SLUG_HTML)

      const slugNoSlash = await fetch(`${baseUrl}/s/${remoteSiteId}/release-page`)
      expect(slugNoSlash.status).toBe(200)
      expect(await slugNoSlash.text()).toBe(SLUG_HTML)

      const cssRes = await fetch(`${baseUrl}/s/${remoteSiteId}/release-page/assets/site.css`)
      expect(cssRes.status).toBe(200)
      expect(await cssRes.text()).toBe(CSS_BODY)
      expect(cssRes.headers.get('content-type') ?? '').toMatch(/text\/css/i)
    } finally {
      close()
    }
  })

  it('根 index 与 source 不一致时 verify 拒绝发布', async () => {
    const dataRoot = await makeIsolatedDataRoot('public-dir-bad-verify')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const manifest = await manifestJsonForPublishedSite(dataRoot)
      const createRes = await fetch(`${baseUrl}/api/remote/sites`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const { remoteSiteId } = (await createRes.json()) as { remoteSiteId: string }
      const repoDir = path.join(dataRoot, 'r', 'dir-bad')
      const { commitId } = await initSiteRepository(repoDir, {
        'olps.manifest.json': manifest,
        'source/site-settings.json': SETTINGS,
        'public/index.html':
          '<!DOCTYPE html><html><head><title>Locale:fr</title></head><body>bad</body></html>',
        'public/release-page/index.html': SLUG_HTML,
      })
      const bundlePath = path.join(dataRoot, 'b', 'dir-bad.bundle')
      await writeGitBundle(repoDir, bundlePath)
      const pushRes = await pushBundleHttp({
        baseUrl,
        token,
        remoteSiteId,
        bundlePath,
        commitId,
        expectedPublishedCommitId: null,
      })
      expect(pushRes.status).toBe(400)
      const pushBody = (await pushRes.json()) as { error: string; log: string }
      expect(pushBody.error).toBe('deploy failed')
      expect(pushBody.log).toContain('public/index.html 缺少与 defaultLocale 一致的标记')
      expect(pushBody.log).toContain('<title>Locale:en</title>')
    } finally {
      close()
    }
  })
})
