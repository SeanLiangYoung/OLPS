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

describe('SyncWorkspace 真实 Agent 需用户决定', () => {
  it(
    '同一字段冲突：首次 Agent 为 awaiting_user，continue 后合并并保留用户选择',
    async () => {
      const dataRoot = await makeIsolatedDataRoot('agent-needs-user')
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
          sandboxRoot: await sandboxRoot('needs-base'),
          draftId: 'draft-needs-base',
          remote,
          build,
        })
        await wsBase.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
        await wsBase.writeFile(SITE_PATHS.siteSettings, Buffer.from(COLLAB_SETTINGS_BASE, 'utf8'))
        await wsBase.writeFile(
          `${SITE_PATHS.publicDir}/index.html`,
          Buffer.from(publicHtmlFromSettings(COLLAB_SETTINGS_BASE), 'utf8'),
        )
        await wsBase.saveVersion('base')
        const v0 = await wsBase.push({ expectedPublishedCommitId: null })

        const wsA = await SyncWorkspace.create({
          sandboxRoot: await sandboxRoot('needs-a'),
          draftId: 'draft-needs-a',
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
        await wsA.saveVersion('A red')
        await wsA.push({ expectedPublishedCommitId: v0.publishedCommitId })

        const sandboxB = await sandboxRoot('needs-b')
        const wsB = await SyncWorkspace.create({
          sandboxRoot: sandboxB,
          draftId: 'draft-needs-b',
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
        await wsB.saveVersion('B green')
        const pulled = await wsB.pull()
        expect(pulled.status).toBe('merge_conflict')

        const first = await wsB.resolveConflictsWithAgent()
        expect(first.status).toBe('awaiting_user')
        expect(first.conflictSummary).toBeTruthy()
        expect(wsB.getState().status).toBe('awaiting_user')
        expect(wsB.getState().pendingIncomingCommitId).toBeTruthy()

        const reopenedAfterAgent = await SyncWorkspace.open({
          sandboxRoot: sandboxB,
          draftId: 'draft-needs-b',
          remote,
          build,
        })
        expect(reopenedAfterAgent.getState().status).toBe('awaiting_user')

        const continued = await wsB.continueAfterUser({
          userMessage: '保留远端已发布的 brandColor 为 red，放弃本地 green。',
        })
        expect(continued.status).toBe('clean')

        const merged = JSON.parse(
          (await wsB.readFile(SITE_PATHS.siteSettings)).toString('utf8'),
        ) as { brandColor: string }
        expect(merged.brandColor).toBe('red')
      } finally {
        close()
      }
    },
    20 * 60 * 1000,
  )
})
