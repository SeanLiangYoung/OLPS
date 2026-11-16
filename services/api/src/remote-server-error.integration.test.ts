import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { applyRemoteEnv, snapshotRemoteEnv, startDedicatedRemote } from './test-support/dedicated-remote-harness.js'

describe('远端服务器错误后恢复发布', () => {
  const pool = createTestPool()
  beforeEach(resetTestDatabase)
  afterAll(() => pool.end())

  it('远端工作目录不可用时保存当前 Git 状态，修复目录后可重试', async () => {
    const previous = snapshotRemoteEnv()
    const remote = await startDedicatedRemote('server-error')
    applyRemoteEnv(remote.baseUrl, remote.token)
    try {
      const user = await registerUser(app, { account: 'server-error', password: 'server-error-pass', name: 'Owner' })
      const call = (method: string, url: string, body?: unknown) => requestJson(app, method, url, { token: user.accessToken, body })
      const created = await call('POST', '/api/drafts', { name: 'Recovery' })
      expect(created.status).toBe(201)
      const draftId = String((created.body.draft as Record<string, unknown>).draftId)
      const root = `/api/drafts/${draftId}`
      expect((await call('POST', `${root}/pages`, { kind: 'site', title: 'Home', slug: 'home' })).status).toBe(201)
      const workRoot = path.join(remote.dataRoot, 'work')
      await fs.writeFile(workRoot, '工作目录不可用')
      const failed = await call('POST', `${root}/push`)
      expect(failed.status).toBe(503)
      expect((failed.body.draft as Record<string, unknown>).status).toBe('error')
      const readable = await call('GET', root)
      expect(readable.status).toBe(200)
      expect((readable.body.draft as Record<string, unknown>).pendingOperation).toBe('push')
      await fs.unlink(workRoot)
      const retried = await call('POST', `${root}/push`)
      expect(retried.status, JSON.stringify(retried.body)).toBe(200)
      const url = String((retried.body.site as Record<string, unknown>).publicUrl)
      expect((await fetch(`${url.replace(/\/$/, '')}/home/`)).status).toBe(200)
    } finally {
      remote.close()
      applyRemoteEnv(previous.baseUrl, previous.token)
    }
  })
})
