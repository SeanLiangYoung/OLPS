import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, expect, it } from 'vitest'
import { app } from './app.js'
import { pool } from './db.js'
import { persistDraftSyncState } from './draft-sync-state.js'
import { createCmsSite, initializeCmsSite } from './cms-sites.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

const database = createTestPool()
afterAll(async () => { await database.end() })

it('更新同步状态保留待处理操作，初始化失败版本仍可列出', async () => {
  await resetTestDatabase()
  const user = await registerUser(app, { account: 'sync-state', password: 'State123!', name: '同步状态用户' })
  const site = await createCmsSite(String(user.user.userId), '同步状态网站')
  expect(await initializeCmsSite(String(user.user.userId), site.siteId)).toEqual({ initStatus: 'ready' })
  await database.query("UPDATE site_drafts SET pending_operation='pull' WHERE draft_id=$1", [site.draftId])
  await persistDraftSyncState(site.draftId, { syncStatus: 'awaiting_user' })
  expect((await database.query('SELECT pending_operation FROM site_drafts WHERE draft_id=$1', [site.draftId])).rows[0].pending_operation).toBe('pull')
  await persistDraftSyncState(site.draftId, { pendingOperation: null, syncStatus: 'clean' })
  expect((await database.query('SELECT pending_operation FROM site_drafts WHERE draft_id=$1', [site.draftId])).rows[0].pending_operation).toBeNull()
  const parent = path.resolve('.intermediate/initialization-failure')
  await fs.mkdir(parent, { recursive: true })
  const blockedRoot = path.join(parent, randomUUID())
  await fs.writeFile(blockedRoot, 'This path is a file')
  try {
    const failed = await createCmsSite(String(user.user.userId), '初始化失败网站', pool, blockedRoot)
    const result = await initializeCmsSite(String(user.user.userId), failed.siteId, pool, blockedRoot)
    expect(result.initStatus).toBe('failed')
    expect(result.error).toContain('ENOTDIR')
    const list = await requestJson(app, 'GET', '/api/drafts', { token: user.accessToken })
    expect(list.status).toBe(200)
    const drafts = list.body.drafts as Array<Record<string, unknown>>
    expect(drafts.find(draft => draft.draftId === site.draftId)?.initStatus).toBe('ready')
    expect(drafts.find(draft => draft.draftId === failed.draftId)?.initStatus).toBe('failed')
  } finally { await fs.rm(blockedRoot, { force: true }) }
}, 30000)

it('网站初始化在单连接数据库连接池中完成内容索引', async () => {
  await resetTestDatabase()
  const user = await registerUser(app, { account: 'init-single-connection', password: 'State123!', name: '网站管理员' })
  const constrained = new pg.Pool({ ...database.options, max: 1, connectionTimeoutMillis: 2000 })
  try {
    const site = await createCmsSite(String(user.user.userId), '单连接初始化网站', constrained)
    const result = await initializeCmsSite(String(user.user.userId), site.siteId, constrained)
    expect(result).toEqual({ initStatus: 'ready' })
    expect(Number((await constrained.query('SELECT count(DISTINCT page_id) FROM pages WHERE draft_id=$1', [site.draftId])).rows[0].count)).toBe(8)
  } finally { await constrained.end() }
}, 30000)
