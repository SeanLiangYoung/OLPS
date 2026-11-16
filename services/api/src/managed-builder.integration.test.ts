import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { appConfig } from './config.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

describe('发布使用当前网站构建器', () => {
  const pool = createTestPool()
  beforeEach(resetTestDatabase)
  afterAll(() => pool.end())

  it('发布时安装当前构建器并保留 manifest 中的其他设置', async () => {
    const user = await registerUser(app, { account: 'managed-builder', password: 'builder-password', name: 'Owner' })
    const call = (method: string, url: string, body?: unknown) => requestJson(app, method, url, { token: user.accessToken, body })
    const created = await call('POST', '/api/drafts', { name: 'Builder' })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const draft = created.body.draft as Record<string, unknown>
    const workspace = path.join(appConfig.sandboxRoot, String(draft.sandboxId))
    const manifestPath = path.join(workspace, 'olps.manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, version: 1, customSetting: 'preserved' }))
    await fs.unlink(path.join(workspace, 'tools/site-build.mjs'))
    const result = await call('POST', `/api/drafts/${draft.draftId}/push`)
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    expect(await fs.readFile(path.join(workspace, 'tools/site-build.mjs'))).toEqual(
      await fs.readFile(path.join(appConfig.root, 'packages/site-builder/dist/site-build.mjs')),
    )
    expect(JSON.parse(await fs.readFile(manifestPath, 'utf8')).customSetting).toBe('preserved')
  })
})
