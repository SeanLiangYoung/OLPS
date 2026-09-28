import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import { sandboxRoot, siteManifestWithVerify } from './test-helpers.js'
import {
  makeIsolatedDataRoot,
  startRemoteServer,
} from '../../../services/remote/src/test-harness.js'

describe('远端 409 后重试发布', () => {
  it('竞争 push 失败者 pull 同步后可再次成功发布', async () => {
    const dataRoot = await makeIsolatedDataRoot('retry-409')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const wsSeed = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('409-seed'),
        draftId: 'draft-409-seed',
        remote,
        build: {
          verifyCommand: JSON.parse(siteManifestWithVerify()).verifyCommand,
          buildCommand: JSON.parse(siteManifestWithVerify()).buildCommand,
        },
      })
      await wsSeed.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await wsSeed.writeFile(SITE_PATHS.siteSettings, Buffer.from(settings, 'utf8'))
      await wsSeed.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>seed</body></html>',
          'utf8',
        ),
      )
      await wsSeed.saveVersion('seed')
      const seed = await wsSeed.push({ expectedPublishedCommitId: null })

      const sandboxLoser = await sandboxRoot('409-loser')
      const wsLoser = await SyncWorkspace.create({
        sandboxRoot: sandboxLoser,
        draftId: 'draft-409-loser',
        remote,
        remoteSiteId: seed.remoteSiteId,
        baseCommitId: seed.publishedCommitId,
        build: {
          verifyCommand: JSON.parse(siteManifestWithVerify()).verifyCommand,
          buildCommand: JSON.parse(siteManifestWithVerify()).buildCommand,
        },
      })
      const wsWinner = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('409-winner'),
        draftId: 'draft-409-winner',
        remote,
        remoteSiteId: seed.remoteSiteId,
        baseCommitId: seed.publishedCommitId,
        build: {
          verifyCommand: JSON.parse(siteManifestWithVerify()).verifyCommand,
          buildCommand: JSON.parse(siteManifestWithVerify()).buildCommand,
        },
      })
      await wsWinner.writeFile(
        `${SITE_PATHS.publicDir}/winner-side.txt`,
        Buffer.from('winner-public-marker', 'utf8'),
      )
      await wsLoser.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>loser</body></html>',
          'utf8',
        ),
      )
      await wsWinner.saveVersion('winner')
      await wsLoser.saveVersion('loser')
      const expected = seed.publishedCommitId
      const [rWin, rLose] = await Promise.all([
        wsWinner.push({ expectedPublishedCommitId: expected }),
        wsLoser.push({ expectedPublishedCommitId: expected }),
      ])
      const loserWs = rWin.status === 'clean' ? wsLoser : wsWinner
      const loserResult = rWin.status === 'clean' ? rLose : rWin
      expect(rWin.status === 'clean' || rLose.status === 'clean').toBe(true)
      expect(loserResult.status).toBe('dirty')
      expect(loserWs.getState().status).not.toBe('awaiting_user')

      const pulled = await loserWs.pull()
      expect(['clean', 'merge_conflict', 'validation_failed']).toContain(pulled.status)

      await loserWs.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>loser-after-sync</body></html>',
          'utf8',
        ),
      )
      await loserWs.saveVersion('loser after sync')
      const site = await fetch(`${baseUrl}/api/remote/sites/${seed.remoteSiteId}`, {
        headers: { Authorization: 'Bearer remote-test-token' },
      })
      const meta = (await site.json()) as { publishedCommitId: string }
      const retry = await loserWs.push({ expectedPublishedCommitId: meta.publishedCommitId })
      expect(retry.status).toBe('clean')
      const page = await fetch(`${baseUrl}/s/${seed.remoteSiteId}/index.html`)
      expect(await page.text()).toContain('loser-after-sync')
      const winnerSide = await fetch(`${baseUrl}/s/${seed.remoteSiteId}/winner-side.txt`)
      expect(await winnerSide.text()).toBe('winner-public-marker')
    } finally {
      close()
    }
  })
})
