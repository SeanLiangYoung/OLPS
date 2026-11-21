import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import { sandboxRoot, siteBuildConfig, siteManifestWithVerify } from './test-helpers.js'
import {
  makeIsolatedDataRoot,
  startRemoteServer,
} from '../../../services/remote/src/test-harness.js'

describe('sandboxRoot 元数据隔离', () => {
  it('相同 draftId 在不同 sandboxRoot 下元数据与仓库互不覆盖', async () => {
    const dataRoot = await makeIsolatedDataRoot('meta-iso')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'remote-test-token',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const remote = { baseUrl, token: 'remote-test-token' }
      const draftId = 'shared-draft-id'
      const sandbox1 = await sandboxRoot('iso-1')
      const sandbox2 = await sandboxRoot('iso-2')

      const ws1 = await SyncWorkspace.create({
        sandboxRoot: sandbox1,
        draftId,
        remote,
        build: siteBuildConfig(),
      })
      await ws1.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await ws1.saveVersion('iso-1-only')

      const ws2 = await SyncWorkspace.create({
        sandboxRoot: sandbox2,
        draftId,
        remote,
        build: siteBuildConfig(),
      })
      await ws2.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
      await ws2.saveVersion('iso-2-only')

      const meta1 = path.join(sandbox1, '.o', 'meta', `${draftId}.json`)
      const meta2 = path.join(sandbox2, '.o', 'meta', `${draftId}.json`)
      const raw2 = await fs.readFile(meta2, 'utf8')
      await ws1.push()
      expect(await fs.readFile(meta2, 'utf8')).toBe(raw2)
      expect(JSON.parse(await fs.readFile(meta1, 'utf8')).remoteSiteId).toBeTruthy()
      expect(JSON.parse(raw2).remoteSiteId).toBeNull()
      expect(await fs.stat(path.join(sandbox1, draftId, '.git'))).toBeTruthy()
      expect(await fs.stat(path.join(sandbox2, draftId, '.git'))).toBeTruthy()
    } finally {
      close()
    }
  })
})
