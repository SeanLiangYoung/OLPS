import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import { sandboxRoot, siteManifestWithVerify } from './test-helpers.js'
import {
  makeIsolatedDataRoot,
  startRemoteServer,
} from '../../../services/remote/src/test-harness.js'

describe('SyncWorkspace 远端完整生命周期', () => {
  it('首次 push、第二草稿 clone、再 push 与 pull', async () => {
    const dataRoot = await makeIsolatedDataRoot('lifecycle')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const ws1 = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('life-1'),
        draftId: 'draft-life-1',
        remote,
      })
      await ws1.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await ws1.writeFile(
        SITE_PATHS.siteSettings,
        Buffer.from(JSON.stringify({ defaultLocale: 'en', locales: ['en'] }), 'utf8'),
      )
      await ws1.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>life-v1</body></html>',
          'utf8',
        ),
      )
      await ws1.saveVersion('life v1')
      const v1 = await ws1.push({ expectedPublishedCommitId: null })

      const ws2 = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('life-2'),
        draftId: 'draft-life-2',
        remote,
        remoteSiteId: v1.remoteSiteId,
        baseCommitId: v1.publishedCommitId,
      })
      expect(ws2.getState().headCommitId).toBe(v1.publishedCommitId)

      await ws2.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>life-v2</body></html>',
          'utf8',
        ),
      )
      await ws2.saveVersion('life v2')
      const v2 = await ws2.push({ expectedPublishedCommitId: v1.publishedCommitId })
      expect(v2.status).toBe('clean')

      const ws3 = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('life-3'),
        draftId: 'draft-life-3',
        remote,
        remoteSiteId: v1.remoteSiteId,
        baseCommitId: v1.publishedCommitId,
      })
      const pulled = await ws3.pull()
      expect(pulled.status).toBe('clean')
      expect(pulled.baseCommitId).toBe(v2.publishedCommitId)
      const html = (await ws3.readFile(`${SITE_PATHS.publicDir}/index.html`)).toString('utf8')
      expect(html).toContain('life-v2')
    } finally {
      close()
    }
  })
})
