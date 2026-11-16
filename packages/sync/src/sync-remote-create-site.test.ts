import { describe, expect, it } from 'vitest'
import { remoteCreateSite } from './remote-client.js'
import { randomUUID } from 'node:crypto'
import {
  makeIsolatedDataRoot,
  startRemoteServer,
} from '../../../services/remote/src/test-harness.js'

describe('remoteCreateSite', () => {
  it('创建远端站点返回 remoteSiteId 与 publicUrl', async () => {
    const dataRoot = await makeIsolatedDataRoot('create-site')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: 'tok',
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const created = await remoteCreateSite({ baseUrl, token: 'tok' })
      expect(created.remoteSiteId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
      expect(created.publicUrl).toContain(`/s/${created.remoteSiteId}/`)
    } finally {
      close()
    }
  })
  it('指定网站标识的并发重试保持同一远端网站', async () => {
    const dataRoot = await makeIsolatedDataRoot('create-site-idempotent')
    const { baseUrl, close } = await startRemoteServer({ dataRoot, serviceToken: 'tok', publicBaseUrl: 'http://127.0.0.1:0' })
    try {
      const remoteSiteId = randomUUID()
      const results = await Promise.all(Array.from({ length: 4 }, () => remoteCreateSite({ baseUrl, token: 'tok' }, { remoteSiteId })))
      for (const result of results) expect(result).toEqual({ remoteSiteId, publicUrl: `${baseUrl}/s/${remoteSiteId}/` })
    } finally { close() }
  })
})
