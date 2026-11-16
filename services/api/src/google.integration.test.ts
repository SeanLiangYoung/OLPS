import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from './db.js'
import { resetTestDatabase } from './test-support/reset-test-db.js'
import { migrateGoogleSchema } from './google-schema.js'
import { consumeGoogleState, createGoogleState, finishGoogleAuthorization, getGoogleStatus, promoteDraftGoogleConnection, resolveGoogleTarget, sealGoogleTokens, unsealGoogleTokens, validateGoogleResourceId } from './google-service.js'
import { googleRoutes } from './google-routes.js'
import { app as mainApp } from './app.js'

describe('Google 授权安全与真实 PostgreSQL', () => {
  let userId: string
  let draftId: string
  let sessionId: string
  let accessToken: string
  beforeEach(async () => {
    await resetTestDatabase()
    await migrateGoogleSchema(pool)
    userId = randomUUID()
    draftId = randomUUID()
    sessionId = randomUUID()
    accessToken = randomBytes(32).toString('base64url')
    await pool.query(`INSERT INTO users VALUES ($1,$1,'unused','Google test',NOW(),NOW())`, [userId])
    await pool.query(`INSERT INTO sessions VALUES ($1,$2,$3,NOW()+INTERVAL '1 hour',NOW())`, [sessionId, userId, createHash('sha256').update(accessToken).digest('hex')])
    await pool.query(`INSERT INTO site_drafts(draft_id,name,sandbox_id,status,created_at,updated_at) VALUES ($1,'Google test',$1,'active',NOW(),NOW())`, [draftId])
    await pool.query(`INSERT INTO draft_owners VALUES ($1,$2,NOW())`, [draftId, userId])
  })
  afterAll(async () => { await pool.end() })

  it('state 与浏览器和登录会话关联并且只能消费一次', async () => {
    const target = await resolveGoogleTarget(userId, 'draft', draftId)
    const pending = await createGoogleState(userId, sessionId, target)
    await expect(consumeGoogleState(pending.state, 'incorrect')).rejects.toThrow('GOOGLE_STATE_INVALID')
    const consumed = await consumeGoogleState(pending.state, pending.browserToken)
    expect(consumed.userId).toBe(userId)
    expect(consumed.target.key).toBe(`draft:${draftId}`)
    await expect(consumeGoogleState(pending.state, pending.browserToken)).rejects.toThrow('GOOGLE_STATE_INVALID')
  })

  it('拒绝过期 state、注销会话及已经撤销的草稿权限', async () => {
    const target = await resolveGoogleTarget(userId, 'draft', draftId)
    const expired = await createGoogleState(userId, sessionId, target)
    await pool.query(`UPDATE google_oauth_states SET expires_at=NOW()-INTERVAL '1 second'`)
    await expect(consumeGoogleState(expired.state, expired.browserToken)).rejects.toThrow('GOOGLE_STATE_INVALID')
    const revoked = await createGoogleState(userId, sessionId, target)
    await pool.query(`DELETE FROM draft_owners WHERE draft_id=$1`, [draftId])
    await expect(consumeGoogleState(revoked.state, revoked.browserToken)).rejects.toThrow('FORBIDDEN')
    await pool.query(`INSERT INTO draft_owners VALUES ($1,$2,NOW())`, [draftId, userId])
    const loggedOut = await createGoogleState(userId, sessionId, target)
    await pool.query(`DELETE FROM sessions WHERE session_id=$1`, [sessionId])
    await expect(consumeGoogleState(loggedOut.state, loggedOut.browserToken)).rejects.toThrow('GOOGLE_STATE_INVALID')
  })

  it('关联网站的草稿必须同时拥有网站权限', async () => {
    const siteId = randomUUID()
    await pool.query(`INSERT INTO sites(site_id,name,settings,created_at,updated_at) VALUES ($1,'Google site','{}',NOW(),NOW())`, [siteId])
    await pool.query(`UPDATE site_drafts SET site_id=$2 WHERE draft_id=$1`, [draftId, siteId])
    await expect(resolveGoogleTarget(userId, 'draft', draftId)).rejects.toThrow('FORBIDDEN')
    await pool.query(`INSERT INTO site_owners VALUES ($1,$2,NOW())`, [siteId, userId])
    expect((await resolveGoogleTarget(userId, 'draft', draftId)).key).toBe(`site:${siteId}`)
  })

  it('授权状态由服务端令牌决定且不会返回凭据', async () => {
    const target = await resolveGoogleTarget(userId, 'draft', draftId)
    const status = await getGoogleStatus(userId, target)
    expect(status.connected).toBe(false)
    expect(JSON.stringify(status)).not.toContain('refresh_token')
    await expect(resolveGoogleTarget(randomUUID(), 'draft', draftId)).rejects.toThrow('FORBIDDEN')
  })

  it('令牌通过 AES-GCM 加密并拒绝篡改', () => {
    const key = randomBytes(32)
    const tokens = { refresh_token: randomBytes(32).toString('hex'), expiry_date: Date.now() }
    const encrypted = sealGoogleTokens(tokens, key)
    expect(encrypted).not.toContain(tokens.refresh_token)
    expect(unsealGoogleTokens(encrypted, key)).toEqual(tokens)
    expect(() => unsealGoogleTokens(encrypted, randomBytes(32))).toThrow()
  })

  it('资源 ID 必须符合 Google 格式', () => {
    expect(validateGoogleResourceId('ads', '123-456-7890')).toBe('1234567890')
    expect(validateGoogleResourceId('ga', '123456789')).toBe('123456789')
    expect(() => validateGoogleResourceId('ads', '123 OR 1=1')).toThrow()
    expect(() => validateGoogleResourceId('ga', 'properties/123')).toThrow()
  })

  it('API 验证登录、资源权限、输入和回调 state', async () => {
    const app = new Hono().route('/', googleRoutes)
    const path = `/api/drafts/${draftId}/google`
    expect((await app.request(path)).status).toBe(401)
    const headers = { authorization: `Bearer ${accessToken}` }
    expect((await app.request(path, { headers })).status).toBe(200)
    expect((await app.request(`/api/drafts/${randomUUID()}/google`, { headers })).status).toBe(403)
    const invalid = await app.request(`${path}/resources`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ adsAccountId: 'invalid' }) })
    expect(invalid.status).toBe(400)
    const callback = await app.request('/api/google/callback?state=invalid&code=invalid')
    expect(callback.status).toBe(400)
    expect(await callback.text()).not.toContain('invalid&code')
    expect((await app.request(path, { method: 'DELETE', headers })).status).toBe(200)
  })

  it('网站关联迁移可以处理没有 Google 授权的草稿', async () => {
    const siteId = randomUUID()
    await pool.query(`INSERT INTO sites(site_id,name,settings,created_at,updated_at) VALUES ($1,'Google site','{}',NOW(),NOW())`, [siteId])
    await promoteDraftGoogleConnection(draftId, siteId, pool)
    expect((await pool.query(`SELECT 1 FROM google_connections`)).rowCount).toBe(0)
  })

  it('取消授权消费 state，已经过期的登录会话拒绝回调', async () => {
    const target = await resolveGoogleTarget(userId, 'draft', draftId)
    const pending = await createGoogleState(userId, sessionId, target)
    await expect(finishGoogleAuthorization(pending.state, pending.browserToken, '', true)).rejects.toThrow('GOOGLE_AUTHORIZATION_DENIED')
    await expect(consumeGoogleState(pending.state, pending.browserToken)).rejects.toThrow('GOOGLE_STATE_INVALID')
    const expired = await createGoogleState(userId, sessionId, target)
    await pool.query(`UPDATE sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE session_id=$1`, [sessionId])
    await expect(consumeGoogleState(expired.state, expired.browserToken)).rejects.toThrow('GOOGLE_STATE_INVALID')
    await expect(createGoogleState(userId, sessionId, target)).rejects.toThrow('GOOGLE_SESSION_INVALID')
  })

  it('授权期间草稿关联网站后拒绝使用原来 state', async () => {
    const target = await resolveGoogleTarget(userId, 'draft', draftId)
    const pending = await createGoogleState(userId, sessionId, target)
    const siteId = randomUUID()
    await pool.query(`INSERT INTO sites(site_id,name,settings,created_at,updated_at) VALUES ($1,'Google site','{}',NOW(),NOW())`, [siteId])
    await pool.query(`INSERT INTO site_owners VALUES ($1,$2,NOW())`, [siteId, userId])
    await pool.query(`UPDATE site_drafts SET site_id=$2 WHERE draft_id=$1`, [draftId, siteId])
    await expect(consumeGoogleState(pending.state, pending.browserToken)).rejects.toThrow('GOOGLE_STATE_INVALID')
  })

  it('没有外部配置时授权 API 返回配置状态且不会保存 state', async () => {
    const app = new Hono().route('/', googleRoutes)
    const headers = { authorization: `Bearer ${accessToken}` }
    const path = `/api/drafts/${draftId}/google`
    const response = await app.request(path, { headers })
    const data = await response.json() as { google: { configured: boolean } }
    if (!data.google.configured) {
      const start = await app.request(`${path}/authorize`, { method: 'POST', headers })
      expect(start.status).toBe(503)
      expect((await pool.query(`SELECT 1 FROM google_oauth_states`)).rowCount).toBe(0)
    }
    const analytics = await app.request(`${path}/analytics`, { headers })
    expect(analytics.status).toBe(409)
  })

  it('旧草稿及网站 API 的 connected 标记由 OAuth 授权与绑定决定', async () => {
    const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }
    const draftPath = `/api/drafts/${draftId}/integrations`
    const save = await mainApp.request(draftPath, { method: 'PATCH', headers,
      body: JSON.stringify({ adsConnected: true, gaConnected: true, adsAccountId: '123-456-7890', gaPropertyId: '123456789' }) })
    expect(save.status).toBe(200)
    expect((await save.json()).integrations).toMatchObject({ adsConnected: false, gaConnected: false })
    await pool.query(`UPDATE site_integrations SET ads_connected=TRUE,ga_connected=TRUE WHERE draft_id=$1`, [draftId])
    const legacy = await mainApp.request(draftPath, { headers })
    expect((await legacy.json()).integrations).toMatchObject({ adsConnected: false, gaConnected: false })
    const siteId = randomUUID()
    await pool.query(`INSERT INTO sites(site_id,name,settings,created_at,updated_at) VALUES ($1,'Google site','{}',NOW(),NOW())`, [siteId])
    await pool.query(`INSERT INTO site_owners VALUES ($1,$2,NOW())`, [siteId, userId])
    await pool.query(`UPDATE site_drafts SET site_id=$2 WHERE draft_id=$1`, [draftId, siteId])
    await pool.query(`UPDATE site_integrations SET site_id=$2 WHERE draft_id=$1`, [draftId, siteId])
    for (const path of [draftPath, `/api/sites/${siteId}/integrations`]) {
      const res = await mainApp.request(path, { method: 'PATCH', headers,
        body: JSON.stringify({ adsConnected: true, gaConnected: true, adsAccountId: '999-888-7777', gaPropertyId: '987654321' }) })
      expect(res.status).toBe(200)
      expect((await res.json()).integrations).toMatchObject({ adsConnected: false, gaConnected: false, adsAccountId: '999-888-7777', gaPropertyId: '987654321' })
    }
    const row = (await pool.query(`SELECT * FROM site_integrations WHERE draft_id=$1`, [draftId])).rows[0]!
    expect(row.ads_connected).toBe(true)
    expect(row.ga_connected).toBe(true)
    expect(row.ads_account_id).toBe('999-888-7777')
    expect((await pool.query(`SELECT 1 FROM google_connections`)).rowCount).toBe(0)
  })
})
