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

describe('草稿同步状态持久化', () => {
  it('pull 冲突后重启 open 仍保留 merge_conflict 与 pendingIncomingCommitId', async () => {
    const dataRoot = await makeIsolatedDataRoot('state-persist')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const build = siteBuildConfig()
      const manifest = siteManifestWithVerify()
      const baseSettings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const wsSeed = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('state-seed'),
        draftId: 'draft-state-seed',
        remote,
        build,
      })
      await wsSeed.writeFile(SITE_PATHS.manifest, Buffer.from(manifest, 'utf8'))
      await wsSeed.writeFile(SITE_PATHS.siteSettings, Buffer.from(baseSettings, 'utf8'))
      await wsSeed.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(baseSettings), 'utf8'),
      )
      await wsSeed.saveVersion('v0')
      const v0 = await wsSeed.push({ expectedPublishedCommitId: null })

      const sandbox = await sandboxRoot('state-b')
      const draftId = 'draft-state-b'
      const wsB = await SyncWorkspace.create({
        sandboxRoot: sandbox,
        draftId,
        remote,
        remoteSiteId: v0.remoteSiteId,
        baseCommitId: v0.publishedCommitId,
        build,
      })
      await wsB.writeFile(
        SITE_PATHS.siteSettings,
        Buffer.from(JSON.stringify({ defaultLocale: 'zh', locales: ['zh'] }), 'utf8'),
      )
      await wsB.saveVersion('B settings')

      const wsA = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('state-a'),
        draftId: 'draft-state-a',
        remote,
        remoteSiteId: v0.remoteSiteId,
        baseCommitId: v0.publishedCommitId,
        build,
      })
      await wsA.writeFile(
        SITE_PATHS.siteSettings,
        Buffer.from(JSON.stringify({ defaultLocale: 'de', locales: ['de'] }), 'utf8'),
      )
      await wsA.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          '<!DOCTYPE html><html><head><title>Locale:de</title></head><body>remote-v2</body></html>',
          'utf8',
        ),
      )
      await wsA.saveVersion('A settings and public')
      const v2 = await wsA.push({ expectedPublishedCommitId: v0.publishedCommitId })

      const pulled = await wsB.pull()
      expect(pulled.status).toBe('merge_conflict')
      expect(pulled.pendingIncomingCommitId).toBe(v2.publishedCommitId)

      const metaPath = path.join(sandbox, '.o', 'meta', `${draftId}.json`)
      await fs.access(metaPath)

      const reopened = await SyncWorkspace.open({
        sandboxRoot: sandbox,
        draftId,
        remote,
      })
      const state = reopened.getState()
      expect(state.status).toBe('merge_conflict')
      expect(state.pendingIncomingCommitId).toBe(v2.publishedCommitId)
      expect(state.conflictSummary).toBeTruthy()
    } finally {
      close()
    }
  })
})
