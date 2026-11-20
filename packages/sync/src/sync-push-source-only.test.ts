import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import { sandboxRoot, siteBuildConfig, siteManifestWithVerify } from './test-helpers.js'
import {
  makeIsolatedDataRoot,
  startRemoteServer,
} from '../../../services/remote/src/test-harness.js'

describe('push 仅修改 source 时由 build 生成 public', () => {
  it('push 后远端 public 与 source 一致且工作区 clean', async () => {
    const dataRoot = await makeIsolatedDataRoot('source-only')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const build = siteBuildConfig()
      const ws0 = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('source-seed'),
        draftId: 'draft-source-seed',
        remote,
        build,
      })
      const settingsV1 = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      await ws0.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await ws0.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsV1, 'utf8'))
      await ws0.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>seed</body></html>',
          'utf8',
        ),
      )
      await ws0.saveVersion('seed')
      const v1 = await ws0.push({ expectedPublishedCommitId: null })

      const ws = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('source-edit'),
        draftId: 'draft-source-edit',
        remote,
        remoteSiteId: v1.remoteSiteId,
        baseCommitId: v1.publishedCommitId,
        build,
      })
      const settingsV2 = JSON.stringify({ defaultLocale: 'de', locales: ['de'] })
      await ws.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsV2, 'utf8'))
      await ws.saveVersion('only source locale de')
      expect(ws.getState().status).toBe('clean')

      const pushed = await ws.push({ expectedPublishedCommitId: v1.publishedCommitId })
      expect(pushed.status).toBe('clean')
      expect(ws.getState().status).toBe('clean')

      const pageRes = await fetch(`${baseUrl}/s/${v1.remoteSiteId}/index.html`)
      expect(pageRes.status).toBe(200)
      expect(await pageRes.text()).toContain('<title>Locale:de</title>')
    } finally {
      close()
    }
  })
})
