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

const V1_BODY = 'V1-COMMON-BODY'
const V2_REMOTE_BODY = 'V2-REMOTE-BODY'
const LOCAL_LOCALE = 'zh'
const COMMON_EN = 'en'

describe('SyncWorkspace pull 与双端修改保留', () => {
  it('V1 共同版本：A push 远端 V2 改 public，B 本地只改 settings，pull 后双方修改保留且 status 为 clean', async () => {
    const dataRoot = await makeIsolatedDataRoot('pull-merge')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const build = siteBuildConfig()
      const manifest = siteManifestWithVerify()
      const v1Settings = JSON.stringify({ defaultLocale: COMMON_EN, locales: [COMMON_EN] })
      const v1Public = publicHtmlFromSettings(v1Settings).replace(
        '></body>',
        `>${V1_BODY}</body>`,
      )

      const wsSeed = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('pull-seed'),
        draftId: 'draft-seed',
        remote,
        build,
      })
      await wsSeed.writeFile(SITE_PATHS.manifest, Buffer.from(manifest, 'utf8'))
      await wsSeed.writeFile(SITE_PATHS.siteSettings, Buffer.from(v1Settings, 'utf8'))
      await wsSeed.writeFile(`${SITE_PATHS.publicDir}/index.html`, Buffer.from(v1Public, 'utf8'))
      await wsSeed.saveVersion('publish v1 common')
      const v1 = await wsSeed.push({ expectedPublishedCommitId: null })

      const wsB = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('pull-b-local'),
        draftId: 'draft-b-local',
        remote,
        remoteSiteId: v1.remoteSiteId,
        baseCommitId: v1.publishedCommitId,
        build,
      })
      const bSettings = JSON.stringify({
        defaultLocale: LOCAL_LOCALE,
        locales: [LOCAL_LOCALE],
      })
      await wsB.writeFile(SITE_PATHS.siteSettings, Buffer.from(bSettings, 'utf8'))
      await wsB.saveVersion('B local settings only')

      const wsA = await SyncWorkspace.create({
        sandboxRoot: await sandboxRoot('pull-a-remote'),
        draftId: 'draft-a-remote',
        remote,
        remoteSiteId: v1.remoteSiteId,
        baseCommitId: v1.publishedCommitId,
        build,
      })
      await wsA.writeFile(SITE_PATHS.siteSettings, Buffer.from(v1Settings, 'utf8'))
      const v2Public = publicHtmlFromSettings(v1Settings).replace(
        '></body>',
        `>${V2_REMOTE_BODY}</body>`,
      )
      await wsA.writeFile(`${SITE_PATHS.publicDir}/index.html`, Buffer.from(v2Public, 'utf8'))
      await wsA.saveVersion('A remote public v2')
      const v2 = await wsA.push({ expectedPublishedCommitId: v1.publishedCommitId })

      const pulled = await wsB.pull()
      expect(pulled.baseCommitId).toBe(v2.publishedCommitId)
      expect(pulled.status).toBe('clean')

      const settingsAfter = JSON.parse(
        (await wsB.readFile(SITE_PATHS.siteSettings)).toString('utf8'),
      ) as { defaultLocale: string }
      expect(settingsAfter.defaultLocale).toBe(LOCAL_LOCALE)

      const htmlAfter = (await wsB.readFile(`${SITE_PATHS.publicDir}/index.html`)).toString(
        'utf8',
      )
      expect(htmlAfter).toContain(V2_REMOTE_BODY)
      expect(htmlAfter).toContain(`<title>Locale:${LOCAL_LOCALE}</title>`)
      expect(htmlAfter).not.toContain(V1_BODY)
    } finally {
      close()
    }
  })
})
