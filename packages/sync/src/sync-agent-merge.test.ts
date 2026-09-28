import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import {
  COLLAB_SETTINGS_BASE,
  publicHtmlFromSettings,
  sandboxRoot,
  settingsWithBrandColor,
  settingsWithSupportEmail,
  siteManifestWithVerify,
} from './test-helpers.js'
import {
  makeIsolatedDataRoot,
  startRemoteServer,
} from '../../../services/remote/src/test-harness.js'

const BRAND_AFTER_A = 'red'
const EMAIL_AFTER_B = 'b@example.com'

describe('SyncWorkspace 真实 Cursor Agent 合并冲突', () => {
  it(
    '共同版本上 A/B 改不同字段：A push 后 B pull 必为 merge_conflict，Agent 后两值保留并 push 公开页',
    async () => {
      const dataRoot = await makeIsolatedDataRoot('agent-merge')
      const { baseUrl, close } = await startRemoteServer({
        dataRoot,
        serviceToken: 'remote-test-token',
        publicBaseUrl: 'http://127.0.0.1:0',
      })
      try {
        const remote = { baseUrl, token: 'remote-test-token' }
        const wsBase = await SyncWorkspace.create({
          sandboxRoot: await sandboxRoot('agent-base'),
          draftId: 'draft-base-v0',
          remote,
          build: {
            verifyCommand: JSON.parse(siteManifestWithVerify()).verifyCommand,
            buildCommand: JSON.parse(siteManifestWithVerify()).buildCommand,
          },
        })
        await wsBase.writeFile(
          SITE_PATHS.manifest,
          Buffer.from(siteManifestWithVerify(), 'utf8'),
        )
        await wsBase.writeFile(
          SITE_PATHS.siteSettings,
          Buffer.from(COLLAB_SETTINGS_BASE, 'utf8'),
        )
        await wsBase.writeFile(
          `${SITE_PATHS.publicDir}/index.html`,
          Buffer.from(publicHtmlFromSettings(COLLAB_SETTINGS_BASE), 'utf8'),
        )
        await wsBase.saveVersion('collab: base v0')
        const v0 = await wsBase.push({ expectedPublishedCommitId: null })

        const wsA = await SyncWorkspace.create({
          sandboxRoot: await sandboxRoot('agent-a'),
          draftId: 'draft-a',
          remote,
          remoteSiteId: v0.remoteSiteId,
          baseCommitId: v0.publishedCommitId,
        })
        const settingsA = settingsWithBrandColor(BRAND_AFTER_A)
        await wsA.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsA, 'utf8'))
        await wsA.writeFile(
          `${SITE_PATHS.publicDir}/index.html`,
          Buffer.from(publicHtmlFromSettings(settingsA), 'utf8'),
        )
        await wsA.saveVersion('collab: A brandColor')
        const vA = await wsA.push({ expectedPublishedCommitId: v0.publishedCommitId })

        const wsB = await SyncWorkspace.create({
          sandboxRoot: await sandboxRoot('agent-b'),
          draftId: 'draft-b',
          remote,
          remoteSiteId: v0.remoteSiteId,
          baseCommitId: v0.publishedCommitId,
        })
        const settingsB = settingsWithSupportEmail(EMAIL_AFTER_B)
        await wsB.writeFile(SITE_PATHS.siteSettings, Buffer.from(settingsB, 'utf8'))
        await wsB.writeFile(
          `${SITE_PATHS.publicDir}/index.html`,
          Buffer.from(publicHtmlFromSettings(settingsB), 'utf8'),
        )
        await wsB.saveVersion('collab: B supportEmail')

        const pulled = await wsB.pull()
        expect(pulled.status).toBe('merge_conflict')

        const resolved = await wsB.resolveConflictsWithAgent()
        expect(resolved.status).toBe('clean')

        const mergedSettings = JSON.parse(
          (await wsB.readFile(SITE_PATHS.siteSettings)).toString('utf8'),
        ) as { brandColor: string; supportEmail: string; defaultLocale: string }
        expect(mergedSettings.brandColor).toBe(BRAND_AFTER_A)
        expect(mergedSettings.supportEmail).toBe(EMAIL_AFTER_B)
        expect(mergedSettings.defaultLocale).toBe('en')

        const pushed = await wsB.push({ expectedPublishedCommitId: vA.publishedCommitId })
        expect(pushed.status).toBe('clean')

        const publicPath = pushed.publicUrl.startsWith('http')
          ? pushed.publicUrl
          : `${baseUrl}${pushed.publicUrl}`
        const pageRes = await fetch(`${publicPath.replace(/\/$/, '')}/index.html`)
        expect(pageRes.status).toBe(200)
        const html = await pageRes.text()
        expect(html).toContain(`data-brand="${BRAND_AFTER_A}"`)
        expect(html).toContain(`data-email="${EMAIL_AFTER_B}"`)
        expect(html).toContain('<title>Locale:en</title>')
      } finally {
        close()
      }
    },
    15 * 60 * 1000,
  )
})
