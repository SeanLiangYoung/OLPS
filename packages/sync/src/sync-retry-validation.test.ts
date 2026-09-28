import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import { publicHtmlFromSettings, sandboxRoot, siteManifestWithVerify } from './test-helpers.js'
import {
  makeIsolatedDataRoot,
  startRemoteServer,
} from '../../../services/remote/src/test-harness.js'

describe('验证失败后的重试', () => {
  it('push 验证失败后修正源码可再次发布，远端仍保持上一成功版本直至成功', async () => {
    const dataRoot = await makeIsolatedDataRoot('retry-push-val')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const settingsV1 = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const ws = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('retry-push-ws'),
        draftId: 'draft-retry-push',
        remote,
      })
      await ws.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await ws.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsV1, 'utf8'))
      await ws.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(settingsV1), 'utf8'),
      )
      await ws.saveVersion('v1')
      const v1 = await ws.push({ expectedPublishedCommitId: null })
      expect(v1.status).toBe('clean')

      const wsBad = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('retry-push-bad'),
        draftId: 'draft-retry-push-bad',
        remote,
        remoteSiteId: v1.remoteSiteId,
        baseCommitId: v1.publishedCommitId,
      })
      const verifyOnlyManifest = JSON.stringify({
        version: 1,
        verifyCommand: JSON.parse(siteManifestWithVerify()).verifyCommand,
      })
      await wsBad.writeFile(SITE_PATHS.manifest, Buffer.from(verifyOnlyManifest, 'utf8'))
      await wsBad.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsV1, 'utf8'))
      await wsBad.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          '<!DOCTYPE html><html><head><title>Locale:fr</title></head><body>bad</body></html>',
          'utf8',
        ),
      )
      await wsBad.saveVersion('bad mismatch')
      const failed = await wsBad.push({ expectedPublishedCommitId: v1.publishedCommitId })
      expect(failed.status).toBe('validation_failed')
      expect(wsBad.getState().status).toBe('validation_failed')

      const pageV1 = await fetch(`${baseUrl}/s/${v1.remoteSiteId}/index.html`)
      expect(await pageV1.text()).toContain('<title>Locale:en</title>')

      const settingsDe = JSON.stringify({ defaultLocale: 'de', locales: ['de'] })
      await wsBad.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await wsBad.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsDe, 'utf8'))
      await wsBad.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(settingsDe), 'utf8'),
      )
      await wsBad.saveVersion('fixed de')
      expect(wsBad.getState().status).toBe('clean')
      const v2 = await wsBad.push({ expectedPublishedCommitId: v1.publishedCommitId })
      expect(v2.status).toBe('clean')
      const pageV2 = await fetch(`${baseUrl}/s/${v1.remoteSiteId}/index.html`)
      expect(await pageV2.text()).toContain('<title>Locale:de</title>')
    } finally {
      close()
    }
  })

  it('pull 合并后验证失败持久化，修复后 pull/push 可成功', async () => {
    const dataRoot = await makeIsolatedDataRoot('retry-pull-val')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const build = {
        verifyCommand: JSON.parse(siteManifestWithVerify()).verifyCommand,
        buildCommand: JSON.parse(siteManifestWithVerify()).buildCommand,
      }
      const settingsEn = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const wsBase = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('retry-pull-base'),
        draftId: 'draft-retry-pull-base',
        remote,
        build,
      })
      await wsBase.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await wsBase.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsEn, 'utf8'))
      await wsBase.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(settingsEn), 'utf8'),
      )
      await wsBase.saveVersion('base')
      const v0 = await wsBase.push({ expectedPublishedCommitId: null })

      const verifyOnly = JSON.stringify({
        version: 1,
        verifyCommand: JSON.parse(siteManifestWithVerify()).verifyCommand,
      })
      const sandboxLocal = await sandboxRoot('retry-pull-local')
      const wsLocal = await SyncWorkspace.create({
        sandboxRoot: sandboxLocal,
        draftId: 'draft-retry-pull-local',
        remote,
        remoteSiteId: v0.remoteSiteId,
        baseCommitId: v0.publishedCommitId,
      })
      await wsLocal.writeFile(SITE_PATHS.manifest, Buffer.from(verifyOnly, 'utf8'))
      await wsLocal.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsEn, 'utf8'))
      await wsLocal.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          '<!DOCTYPE html><html><head><title>Locale:fr</title></head><body>local-bad</body></html>',
          'utf8',
        ),
      )
      await wsLocal.saveVersion('local bad public')

      const wsRemote = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('retry-pull-remote'),
        draftId: 'draft-retry-pull-remote',
        remote,
        remoteSiteId: v0.remoteSiteId,
        baseCommitId: v0.publishedCommitId,
        build,
      })
      await wsRemote.writeFile(
        `${SITE_PATHS.publicDir}/assets/remote-v1-marker.txt`,
        Buffer.from('v1-marker', 'utf8'),
      )
      await wsRemote.saveVersion('remote asset v1')
      const v1 = await wsRemote.push({ expectedPublishedCommitId: v0.publishedCommitId })

      const pulled = await wsLocal.pull()
      expect(pulled.status).toBe('validation_failed')
      expect(wsLocal.getState().status).toBe('validation_failed')

      const reopened = await SyncWorkspace.open({
        sandboxRoot: sandboxLocal,
        draftId: 'draft-retry-pull-local',
        remote,
      })
      expect(reopened.getState().status).toBe('validation_failed')

      await reopened.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(settingsEn), 'utf8'),
      )
      await reopened.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await reopened.saveVersion('fix public for en')
      const pushed = await reopened.push({ expectedPublishedCommitId: v1.publishedCommitId })
      expect(pushed.status).toBe('clean')
      const page = await fetch(`${baseUrl}/s/${v0.remoteSiteId}/index.html`)
      expect(await page.text()).toContain('<title>Locale:en</title>')
      const asset = await fetch(
        `${baseUrl}/s/${v0.remoteSiteId}/assets/remote-v1-marker.txt`,
      )
      expect(await asset.text()).toBe('v1-marker')
    } finally {
      close()
    }
  })
})
