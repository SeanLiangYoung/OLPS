import { describe, expect, it } from 'vitest'
import { SyncWorkspace } from './index.js'
import { sandboxRoot, siteBuildConfig, siteManifestWithVerify } from './test-helpers.js'
import { SITE_PATHS } from './paths.js'
import {
  makeIsolatedDataRoot,
  startRemoteServer,
} from '../../../services/remote/src/test-harness.js'
import { gitOrThrow } from './git-exec.js'

describe('从远端创建草稿保留 Git 历史', () => {
  it('create 后 merge-base(baseCommitId, HEAD) 等于 baseCommitId', async () => {
    const dataRoot = await makeIsolatedDataRoot('clone-history')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const ws0 = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('hist-seed'),
        draftId: 'draft-hist-seed',
        remote,
        build: siteBuildConfig(),
      })
      const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      await ws0.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await ws0.writeFile(SITE_PATHS.siteSettings, Buffer.from(settings, 'utf8'))
      await ws0.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>seed</body></html>',
          'utf8',
        ),
      )
      await ws0.saveVersion('seed')
      const v1 = await ws0.push({ expectedPublishedCommitId: null })

      const wsB = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('hist-b'),
        draftId: 'draft-hist-b',
        remote,
        remoteSiteId: v1.remoteSiteId,
        baseCommitId: v1.publishedCommitId,
      })
      const state = wsB.getState()
      const mergeBase = gitOrThrow(state.workspacePath, [
        'merge-base',
        v1.publishedCommitId,
        'HEAD',
      ])
      expect(mergeBase).toBe(v1.publishedCommitId)
    } finally {
      close()
    }
  })

  it('远端已发布 V2 时仍可从 bundle 在 baseCommitId=V1 创建工作区', async () => {
    const dataRoot = await makeIsolatedDataRoot('clone-v1-from-v2')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const ws0 = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('v1-seed'),
        draftId: 'draft-v1-seed',
        remote,
        build: siteBuildConfig(),
      })
      const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      await ws0.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await ws0.writeFile(SITE_PATHS.siteSettings, Buffer.from(settings, 'utf8'))
      await ws0.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>V1-BODY</body></html>',
          'utf8',
        ),
      )
      await ws0.saveVersion('v1')
      const v1 = await ws0.push({ expectedPublishedCommitId: null })

      const wsA = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('v2-push'),
        draftId: 'draft-v2-push',
        remote,
        remoteSiteId: v1.remoteSiteId,
        baseCommitId: v1.publishedCommitId,
        build: siteBuildConfig(),
      })
      await wsA.writeFile(
        `${SITE_PATHS.publicDir}/index.html`,
        Buffer.from(
          '<!DOCTYPE html><html><head><title>Locale:en</title></head><body>V2-BODY</body></html>',
          'utf8',
        ),
      )
      await wsA.saveVersion('v2')
      await wsA.push({ expectedPublishedCommitId: v1.publishedCommitId })

      const wsFromV1 = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('from-v1'),
        draftId: 'draft-from-v1',
        remote,
        remoteSiteId: v1.remoteSiteId,
        baseCommitId: v1.publishedCommitId,
      })
      expect(wsFromV1.getState().headCommitId).toBe(v1.publishedCommitId)
      const html = (await wsFromV1.readFile(`${SITE_PATHS.publicDir}/index.html`)).toString('utf8')
      expect(html).toContain('V1-BODY')
      expect(html).not.toContain('V2-BODY')
    } finally {
      close()
    }
  })
})
