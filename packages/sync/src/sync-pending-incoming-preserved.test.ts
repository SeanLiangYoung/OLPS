import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import {
  COLLAB_SETTINGS_BASE,
  publicHtmlFromSettings,
  sandboxRoot,
  settingsWithBrandColor,
  siteManifestWithVerify,
} from './test-helpers.js'
import {
  makeIsolatedDataRoot,
  startRemoteServer,
} from '../../../services/remote/src/test-harness.js'

describe('合并冲突期间 pendingIncomingCommitId', () => {
  it('远端升到 V2 后再次 pull 仍保留正在合并的 V1', async () => {
    const dataRoot = await makeIsolatedDataRoot('pending-preserve')
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
      const wsBase = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('pend-base'),
        draftId: 'draft-pend-base',
        remote,
        build,
      })
      await wsBase.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await wsBase.writeFile(SITE_PATHS.siteSettings, Buffer.from(COLLAB_SETTINGS_BASE, 'utf8'))
      await wsBase.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(COLLAB_SETTINGS_BASE), 'utf8'),
      )
      await wsBase.saveVersion('v0')
      const v0 = await wsBase.push({ expectedPublishedCommitId: null })

      const sandboxB = await sandboxRoot('pend-b')
      const wsB = await SyncWorkspace.create({
        sandboxRoot: sandboxB,
        draftId: 'draft-pend-b',
        remote,
        remoteSiteId: v0.remoteSiteId,
        baseCommitId: v0.publishedCommitId,
        build,
      })
      const settingsB = settingsWithBrandColor('green')
      await wsB.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsB, 'utf8'))
      await wsB.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(settingsB), 'utf8'),
      )
      await wsB.saveVersion('B local')

      const wsA = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('pend-a'),
        draftId: 'draft-pend-a',
        remote,
        remoteSiteId: v0.remoteSiteId,
        baseCommitId: v0.publishedCommitId,
        build,
      })
      const settingsA = settingsWithBrandColor('red')
      await wsA.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsA, 'utf8'))
      await wsA.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(settingsA), 'utf8'),
      )
      await wsA.saveVersion('A v1')
      const v1 = await wsA.push({ expectedPublishedCommitId: v0.publishedCommitId })

      const firstPull = await wsB.pull()
      expect(firstPull.status).toBe('merge_conflict')
      expect(firstPull.pendingIncomingCommitId).toBe(v1.publishedCommitId)

      const wsC = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('pend-c'),
        draftId: 'draft-pend-c',
        remote,
        remoteSiteId: v0.remoteSiteId,
        baseCommitId: v1.publishedCommitId,
        build,
      })
      const settingsC = settingsWithBrandColor('purple')
      await wsC.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsC, 'utf8'))
      await wsC.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(settingsC), 'utf8'),
      )
      await wsC.saveVersion('C v2')
      const v2 = await wsC.push({ expectedPublishedCommitId: v1.publishedCommitId })

      const secondPull = await wsB.pull()
      expect(secondPull.status).toBe('merge_conflict')
      expect(secondPull.pendingIncomingCommitId).toBe(v1.publishedCommitId)
      expect(secondPull.pendingIncomingCommitId).not.toBe(v2.publishedCommitId)

      const reopened = await SyncWorkspace.open({
        sandboxRoot: sandboxB,
        draftId: 'draft-pend-b',
        remote,
      })
      const state = reopened.getState()
      expect(state.status).toBe('merge_conflict')
      expect(state.pendingIncomingCommitId).toBe(v1.publishedCommitId)
    } finally {
      close()
    }
  })
})
