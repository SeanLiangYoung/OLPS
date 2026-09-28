import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import {
  publicHtmlFromSettings,
  sandboxRoot,
  siteManifestWithVerify,
} from './test-helpers.js'
import {
  makeIsolatedDataRoot,
  startRemoteServer,
} from '../../../services/remote/src/test-harness.js'

describe('SyncWorkspace 与独立远端 HTTP 协作', () => {
  it('首次 push 创建 remoteSiteId、部署并可通过公开 URL 读取 public/index.html', async () => {
    const dataRoot = await makeIsolatedDataRoot('first-push')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const ws = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('push1'),
        draftId: 'draft-push-1',
        remote,
      })
      await ws.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await ws.writeFile(SITE_PATHS.siteSettings, Buffer.from(settings, 'utf8'))
      await ws.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(settings), 'utf8'),
      )
      await ws.saveVersion('public: first page')
      const pushed = await ws.push({ expectedPublishedCommitId: null })
      expect(pushed.remoteSiteId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
      expect(pushed.publishedCommitId).toMatch(/^[0-9a-f]{40}$/)
      const publicPath = pushed.publicUrl.startsWith('http')
        ? pushed.publicUrl
        : `${baseUrl}${pushed.publicUrl}`
      const pageRes = await fetch(`${publicPath.replace(/\/$/, '')}/index.html`)
      expect(pageRes.status).toBe(200)
      expect(await pageRes.text()).toContain('<title>Locale:en</title>')
    } finally {
      close()
    }
  })

  it('expectedPublishedCommitId 与远端不一致时 push 返回 409 且公开页面保持不变', async () => {
    const dataRoot = await makeIsolatedDataRoot('conflict-push')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const settingsEn = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const wsA = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('push-a'),
        draftId: 'draft-a',
        remote,
      })
      await wsA.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await wsA.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsEn, 'utf8'))
      await wsA.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          `<!DOCTYPE html><html><head><title>Locale:en</title></head><body>version-a</body></html>`,
          'utf8',
        ),
      )
      await wsA.saveVersion('v-a')
      const first = await wsA.push({ expectedPublishedCommitId: null })
      const wsB = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('push-b'),
        draftId: 'draft-b',
        remote,
        remoteSiteId: first.remoteSiteId,
        baseCommitId: first.publishedCommitId,
      })
      await wsB.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          `<!DOCTYPE html><html><head><title>Locale:en</title></head><body>version-b</body></html>`,
          'utf8',
        ),
      )
      await wsB.saveVersion('v-b')
      const stale = await wsB.push({
        expectedPublishedCommitId: '0'.repeat(40),
      })
      expect(stale.status).toBe('dirty')
      expect(wsB.getState().status).not.toBe('awaiting_user')
      const pageRes = await fetch(`${baseUrl}/s/${first.remoteSiteId}/index.html`)
      expect(pageRes.status).toBe(200)
      const pageText = await pageRes.text()
      expect(pageText).toContain('version-a')
      expect(pageText).not.toContain('version-b')
    } finally {
      close()
    }
  })

  it('并发 push 比较 expectedPublishedCommitId：仅一个成功，失败者不改变公开页', async () => {
    const dataRoot = await makeIsolatedDataRoot('concurrent-push')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const wsSeed = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('concurrent-seed'),
        draftId: 'draft-seed',
        remote,
      })
      await wsSeed.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await wsSeed.writeFile(SITE_PATHS.siteSettings, Buffer.from(settings, 'utf8'))
      await wsSeed.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          `<!DOCTYPE html><html><head><title>Locale:en</title></head><body>seed</body></html>`,
          'utf8',
        ),
      )
      await wsSeed.saveVersion('seed')
      const seed = await wsSeed.push({ expectedPublishedCommitId: null })

      const ws1 = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('concurrent-1'),
        draftId: 'draft-c1',
        remote,
        remoteSiteId: seed.remoteSiteId,
        baseCommitId: seed.publishedCommitId,
      })
      const ws2 = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('concurrent-2'),
        draftId: 'draft-c2',
        remote,
        remoteSiteId: seed.remoteSiteId,
        baseCommitId: seed.publishedCommitId,
      })
      await ws1.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          `<!DOCTYPE html><html><head><title>Locale:en</title></head><body>winner</body></html>`,
          'utf8',
        ),
      )
      await ws2.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          `<!DOCTYPE html><html><head><title>Locale:en</title></head><body>loser</body></html>`,
          'utf8',
        ),
      )
      await ws1.saveVersion('c1')
      await ws2.saveVersion('c2')
      const expected = seed.publishedCommitId
      const [r1, r2] = await Promise.all([
        ws1.push({ expectedPublishedCommitId: expected }),
        ws2.push({ expectedPublishedCommitId: expected }),
      ])
      const statuses = [r1.status, r2.status]
      expect(statuses.filter((s) => s === 'clean')).toHaveLength(1)
      expect(statuses.filter((s) => s === 'dirty').length).toBeGreaterThanOrEqual(1)
      const page = await fetch(`${baseUrl}/s/${seed.remoteSiteId}/index.html`)
      const text = await page.text()
      expect(text.includes('winner') || text.includes('loser')).toBe(true)
      expect(text.includes('seed')).toBe(false)
    } finally {
      close()
    }
  })

  it('服务重启后 GET 站点信息与公开页仍为同一 publishedCommitId 与内容', async () => {
    const dataRoot = await makeIsolatedDataRoot('restart')
    const config = {
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    }
    const first = await startRemoteServer(config)
    let remoteSiteId = ''
    let publishedCommitId = ''
    try {
      const remote = { baseUrl: first.baseUrl, token: 'remote-test-token' }
      const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const ws = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('restart-ws'),
        draftId: 'draft-restart',
        remote,
      })
      await ws.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await ws.writeFile(SITE_PATHS.siteSettings, Buffer.from(settings, 'utf8'))
      await ws.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          `<!DOCTYPE html><html><head><title>Locale:en</title></head><body>persist-body</body></html>`,
          'utf8',
        ),
      )
      await ws.saveVersion('persist')
      const pushed = await ws.push({ expectedPublishedCommitId: null })
      remoteSiteId = pushed.remoteSiteId
      publishedCommitId = pushed.publishedCommitId
      const metaRes = await fetch(`${first.baseUrl}/api/remote/sites/${remoteSiteId}`, {
        headers: { Authorization: 'Bearer remote-test-token' },
      })
      expect(metaRes.status).toBe(200)
      const meta = (await metaRes.json()) as { publishedCommitId: string }
      expect(meta.publishedCommitId).toBe(publishedCommitId)
    } finally {
      first.close()
    }
    const second = await startRemoteServer(config)
    try {
      const metaRes = await fetch(`${second.baseUrl}/api/remote/sites/${remoteSiteId}`, {
        headers: { Authorization: 'Bearer remote-test-token' },
      })
      expect(metaRes.status).toBe(200)
      const meta = (await metaRes.json()) as { publishedCommitId: string }
      expect(meta.publishedCommitId).toBe(publishedCommitId)
      const res = await fetch(`${second.baseUrl}/s/${remoteSiteId}/index.html`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('persist-body')
    } finally {
      second.close()
    }
  })

  it('verify 失败时 push 不切换远端公开版本', async () => {
    const dataRoot = await makeIsolatedDataRoot('verify-fail-push')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const ws = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('verify-good'),
        draftId: 'draft-verify-good',
        remote,
      })
      await ws.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await ws.writeFile(SITE_PATHS.siteSettings, Buffer.from(settings, 'utf8'))
      await ws.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(settings), 'utf8'),
      )
      await ws.saveVersion('good')
      const good = await ws.push({ expectedPublishedCommitId: null })

      const wsBad = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('verify-bad'),
        draftId: 'draft-verify-bad',
        remote,
        remoteSiteId: good.remoteSiteId,
        baseCommitId: good.publishedCommitId,
      })
      const verifyOnlyManifest = JSON.stringify({
        version: 1,
        verifyCommand: JSON.parse(siteManifestWithVerify()).verifyCommand,
      })
      await wsBad.writeFile(SITE_PATHS.manifest, Buffer.from(verifyOnlyManifest, 'utf8'))
      await wsBad.writeFile(SITE_PATHS.siteSettings, Buffer.from(settings, 'utf8'))
      await wsBad.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          '<!DOCTYPE html><html><head><title>Locale:fr</title></head><body>bad</body></html>',
          'utf8',
        ),
      )
      await wsBad.saveVersion('bad mismatch')
      const badPush = await wsBad.push({ expectedPublishedCommitId: good.publishedCommitId })
      expect(badPush.status).toBe('validation_failed')
      const page = await fetch(`${baseUrl}/s/${good.remoteSiteId}/index.html`)
      const pageText = await page.text()
      expect(pageText).toContain('<title>Locale:en</title>')
      expect(pageText).not.toContain('Locale:fr')
    } finally {
      close()
    }
  })
})
