import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import { finalizeAgentResolvedMerge } from './agent-merge.js'
import { gitUnmergedPaths } from './git-bundle.js'
import {
  COLLAB_SETTINGS_BASE,
  publicHtmlFromSettings,
  sandboxRoot,
  settingsWithBrandColor,
  settingsWithSupportEmail,
  siteBuildConfig,
  siteManifestWithVerify,
} from './test-helpers.js'
import {
  makeIsolatedDataRoot,
  startRemoteServer,
} from '../../../services/remote/src/test-harness.js'

describe('Agent 合并暂存顺序', () => {
  it('工作区已清除冲突标记但索引仍为未合并时，验证后暂存可完成合并', async () => {
    const dataRoot = await makeIsolatedDataRoot('merge-stage')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const build = {
        ...siteBuildConfig(),
      }
      const wsBase = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('stage-base'),
        draftId: 'draft-stage-base',
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
        sandboxRoot: await sandboxRoot('stage-a'),
        draftId: 'draft-stage-a',
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
      await wsA.saveVersion('A')
      await wsA.push({ expectedPublishedCommitId: v0.publishedCommitId })

      const sandboxB = await sandboxRoot('stage-b')
      const wsB = await SyncWorkspace.create({
        sandboxRoot: sandboxB,
        draftId: 'draft-stage-b',
        remote,
        remoteSiteId: v0.remoteSiteId,
        baseCommitId: v0.publishedCommitId,
        build,
      })
      const settingsB = settingsWithSupportEmail('b@example.com')
      await wsB.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsB, 'utf8'))
      await wsB.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(settingsB), 'utf8'),
      )
      await wsB.saveVersion('B')
      const pulled = await wsB.pull()
      expect(pulled.status).toBe('merge_conflict')

      const mergedSettings = JSON.stringify({
        defaultLocale: 'en',
        locales: ['en'],
        brandColor: 'red',
        supportEmail: 'b@example.com',
      })
      await wsB.writeFile(SITE_PATHS.siteSettings, Buffer.from(mergedSettings, 'utf8'))
      await wsB.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(publicHtmlFromSettings(mergedSettings), 'utf8'),
      )

      const workspacePath = `${sandboxB}/draft-stage-b`
      const conflictFiles = gitUnmergedPaths(workspacePath)
      expect(conflictFiles.length).toBeGreaterThan(0)

      const finalized = await finalizeAgentResolvedMerge({
        workspacePath,
        build,
        conflictFiles,
      })
      expect(finalized.ok).toBe(true)
    } finally {
      close()
    }
  })
})
