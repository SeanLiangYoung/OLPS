import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import {
  queryDraftOwnerAccounts,
  queryDraftOwnerUserIds,
  querySiteOwnerAccounts,
  querySiteOwnerUserIds,
  runWhileBlockingDraftOwnerRemoval,
  runWhileBlockingSiteOwnerRemoval,
} from './test-support/owner-race-coordination.js'

const sharedPool = createTestPool()

afterAll(async () => {
  await sharedPool.end()
})

describe('草稿所有权修改锁与并发', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  async function authToken(account: string): Promise<string> {
    const reg = await registerUser(app, {
      account,
      password: 'race-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  async function userIdForToken(token: string): Promise<string> {
    const me = await requestJson(app, 'GET', '/api/auth/me', { token })
    expect(me.status).toBe(200)
    return String((me.body.user as Record<string, unknown>).userId)
  }

  it('移除所有者在资源锁内撤销操作者权限后 HTTP 拒绝且目标仍保留', async () => {
    const tokenA = await authToken('lock-draft-a')
    const tokenB = await authToken('lock-draft-b')
    await registerUser(app, { account: 'lock-draft-c', password: 'race-pass', name: 'lock-draft-c' })

    const created = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Lock Draft' },
    })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    const addB = await requestJson(app, 'POST', `/api/drafts/${draftId}/owners`, {
      token: tokenA,
      body: { account: 'lock-draft-b' },
    })
    expect(addB.status).toBe(200)
    const addC = await requestJson(app, 'POST', `/api/drafts/${draftId}/owners`, {
      token: tokenA,
      body: { account: 'lock-draft-c' },
    })
    expect(addC.status).toBe(200)

    const userIdA = await userIdForToken(tokenA)
    const userIdB = await userIdForToken(tokenB)
    const beforeAccounts = await queryDraftOwnerAccounts(sharedPool, draftId)

    const removed = await runWhileBlockingDraftOwnerRemoval(
      sharedPool,
      draftId,
      userIdA,
      () =>
        requestJson(app, 'DELETE', `/api/drafts/${draftId}/owners/${userIdB}`, { token: tokenA }),
    )
    expect(removed.status).toBe(403)

    const afterAccounts = await queryDraftOwnerAccounts(sharedPool, draftId)
    const expectedAfter = beforeAccounts.filter((account) => account !== 'lock-draft-a').sort()
    expect(afterAccounts.sort()).toEqual(expectedAfter)
    expect(await queryDraftOwnerUserIds(sharedPool, draftId)).toContain(userIdB)
  })

  it('并发添加与移除所有者后数据库集合与各响应一致且至少保留一名', async () => {
    const tokenA = await authToken('conc-draft-a')
    const regB = await registerUser(app, {
      account: 'conc-draft-b',
      password: 'race-pass',
      name: 'conc-draft-b',
    })
    expect(regB.status).toBe(201)
    await registerUser(app, {
      account: 'conc-draft-new',
      password: 'race-pass',
      name: 'conc-draft-new',
    })

    const created = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Concurrent Draft' },
    })
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    await requestJson(app, 'POST', `/api/drafts/${draftId}/owners`, {
      token: tokenA,
      body: { account: 'conc-draft-b' },
    })

    const userIdB = String(regB.user.userId)

    const beforeAccounts = await queryDraftOwnerAccounts(sharedPool, draftId)

    const [removeRes, addRes] = await Promise.all([
      requestJson(app, 'DELETE', `/api/drafts/${draftId}/owners/${userIdB}`, { token: tokenA }),
      requestJson(app, 'POST', `/api/drafts/${draftId}/owners`, {
        token: tokenA,
        body: { account: 'conc-draft-new' },
      }),
    ])

    const afterAccounts = await queryDraftOwnerAccounts(sharedPool, draftId)
    expect(afterAccounts.length).toBeGreaterThanOrEqual(1)

    if (removeRes.status === 200) {
      expect(afterAccounts).not.toContain('conc-draft-b')
    } else {
      expect(removeRes.status === 403 || removeRes.status === 409).toBe(true)
    }
    if (addRes.status === 200) {
      expect(afterAccounts).toContain('conc-draft-new')
    } else {
      expect(addRes.status === 403 || addRes.status === 409).toBe(true)
    }
    if (removeRes.status !== 200 && addRes.status !== 200) {
      expect(afterAccounts.sort()).toEqual(beforeAccounts.sort())
    }
  })

  it('双向并发移除所有者不得清空所有者集合', async () => {
    const tokenA = await authToken('dual-draft-a')
    const tokenB = await authToken('dual-draft-b')

    const created = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Dual Remove Draft' },
    })
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    await requestJson(app, 'POST', `/api/drafts/${draftId}/owners`, {
      token: tokenA,
      body: { account: 'dual-draft-b' },
    })

    const userIdA = await userIdForToken(tokenA)
    const userIdB = await userIdForToken(tokenB)

    const [removeByA, removeByB] = await Promise.all([
      requestJson(app, 'DELETE', `/api/drafts/${draftId}/owners/${userIdB}`, { token: tokenA }),
      requestJson(app, 'DELETE', `/api/drafts/${draftId}/owners/${userIdA}`, { token: tokenB }),
    ])

    const afterIds = await queryDraftOwnerUserIds(sharedPool, draftId)
    expect(afterIds.length).toBeGreaterThanOrEqual(1)

    const successCount = [removeByA.status, removeByB.status].filter((s) => s === 200).length
    expect(successCount).toBeLessThanOrEqual(1)

    if (removeByA.status === 200) {
      expect(afterIds).not.toContain(userIdB)
    }
    if (removeByB.status === 200) {
      expect(afterIds).not.toContain(userIdA)
    }
    if (removeByA.status !== 200) {
      expect(removeByA.status === 403 || removeByA.status === 409).toBe(true)
    }
    if (removeByB.status !== 200) {
      expect(removeByB.status === 403 || removeByB.status === 409).toBe(true)
    }
  })
})

describe('网站所有权修改锁与并发', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  async function authToken(account: string): Promise<string> {
    const reg = await registerUser(app, {
      account,
      password: 'race-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  async function userIdForToken(token: string): Promise<string> {
    const me = await requestJson(app, 'GET', '/api/auth/me', { token })
    expect(me.status).toBe(200)
    return String((me.body.user as Record<string, unknown>).userId)
  }

  async function publishedSiteId(token: string, draftName: string): Promise<string> {
    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: draftName },
    })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)
    const push = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
    expect(push.status).toBe(200)
    return String((push.body.site as Record<string, unknown>).siteId)
  }

  it('移除所有者在资源锁内撤销操作者权限后 HTTP 拒绝且目标仍保留', async () => {
    const tokenA = await authToken('lock-site-a')
    const tokenB = await authToken('lock-site-b')
    const regC = await registerUser(app, {
      account: 'lock-site-c',
      password: 'race-pass',
      name: 'lock-site-c',
    })
    expect(regC.status).toBe(201)

    const siteId = await publishedSiteId(tokenA, 'Lock Site Draft')

    await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
      token: tokenA,
      body: { account: 'lock-site-b' },
    })
    await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
      token: tokenA,
      body: { account: 'lock-site-c' },
    })

    const userIdA = await userIdForToken(tokenA)
    const userIdB = await userIdForToken(tokenB)
    const beforeAccounts = await querySiteOwnerAccounts(sharedPool, siteId)

    const removed = await runWhileBlockingSiteOwnerRemoval(sharedPool, siteId, userIdA, () =>
      requestJson(app, 'DELETE', `/api/sites/${siteId}/owners/${userIdB}`, { token: tokenA }),
    )
    expect(removed.status).toBe(403)

    const afterAccounts = await querySiteOwnerAccounts(sharedPool, siteId)
    const expectedAfter = beforeAccounts.filter((account) => account !== 'lock-site-a').sort()
    expect(afterAccounts.sort()).toEqual(expectedAfter)
    expect(await querySiteOwnerUserIds(sharedPool, siteId)).toContain(userIdB)
  })

  it('并发添加与移除所有者后数据库集合与各响应一致且至少保留一名', async () => {
    const tokenA = await authToken('conc-site-a')
    const regB = await registerUser(app, {
      account: 'conc-site-b',
      password: 'race-pass',
      name: 'conc-site-b',
    })
    expect(regB.status).toBe(201)
    await registerUser(app, {
      account: 'conc-site-new',
      password: 'race-pass',
      name: 'conc-site-new',
    })

    const siteId = await publishedSiteId(tokenA, 'Concurrent Site Draft')
    await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
      token: tokenA,
      body: { account: 'conc-site-b' },
    })

    const userIdB = String(regB.user.userId)
    const beforeAccounts = await querySiteOwnerAccounts(sharedPool, siteId)

    const [removeRes, addRes] = await Promise.all([
      requestJson(app, 'DELETE', `/api/sites/${siteId}/owners/${userIdB}`, { token: tokenA }),
      requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
        token: tokenA,
        body: { account: 'conc-site-new' },
      }),
    ])

    const afterAccounts = await querySiteOwnerAccounts(sharedPool, siteId)
    expect(afterAccounts.length).toBeGreaterThanOrEqual(1)

    if (removeRes.status === 200) {
      expect(afterAccounts).not.toContain('conc-site-b')
    } else {
      expect(removeRes.status === 403 || removeRes.status === 409).toBe(true)
    }
    if (addRes.status === 200) {
      expect(afterAccounts).toContain('conc-site-new')
    } else {
      expect(addRes.status === 403 || addRes.status === 409).toBe(true)
    }
    if (removeRes.status !== 200 && addRes.status !== 200) {
      expect(afterAccounts.sort()).toEqual(beforeAccounts.sort())
    }
  })

  it('双向并发移除所有者不得清空所有者集合', async () => {
    const tokenA = await authToken('dual-site-a')
    const tokenB = await authToken('dual-site-b')

    const siteId = await publishedSiteId(tokenA, 'Dual Site Draft')
    await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
      token: tokenA,
      body: { account: 'dual-site-b' },
    })

    const userIdA = await userIdForToken(tokenA)
    const userIdB = await userIdForToken(tokenB)

    const [removeByA, removeByB] = await Promise.all([
      requestJson(app, 'DELETE', `/api/sites/${siteId}/owners/${userIdB}`, { token: tokenA }),
      requestJson(app, 'DELETE', `/api/sites/${siteId}/owners/${userIdA}`, { token: tokenB }),
    ])

    const afterIds = await querySiteOwnerUserIds(sharedPool, siteId)
    expect(afterIds.length).toBeGreaterThanOrEqual(1)

    const successCount = [removeByA.status, removeByB.status].filter((s) => s === 200).length
    expect(successCount).toBeLessThanOrEqual(1)
  })
})

describe('撤销网站所有权后仍保留草稿所有权', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  async function authToken(account: string): Promise<string> {
    const reg = await registerUser(app, {
      account,
      password: 'revoke-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  it('被撤销网站所有权的用户不能访问网站列表与详情', async () => {
    const tokenA = await authToken('revoke-list-a')
    const tokenB = await authToken('revoke-list-b')

    const draftA = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Site List Draft' },
    })
    const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)
    const push = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
    expect(push.status).toBe(200)
    const siteId = String((push.body.site as Record<string, unknown>).siteId)

    await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
      token: tokenA,
      body: { account: 'revoke-list-b' },
    })

    await requestJson(app, 'POST', '/api/drafts', {
      token: tokenB,
      body: { name: 'B linked draft', siteId },
    })

    const meB = await requestJson(app, 'GET', '/api/auth/me', { token: tokenB })
    const userIdB = String((meB.body.user as Record<string, unknown>).userId)

    await requestJson(app, 'DELETE', `/api/sites/${siteId}/owners/${userIdB}`, { token: tokenA })

    const sites = await requestJson(app, 'GET', '/api/sites', { token: tokenB })
    expect(sites.status).toBe(200)
    expect(sites.body.sites as unknown[]).toEqual([])

    const siteDetail = await requestJson(app, 'GET', `/api/sites/${siteId}`, { token: tokenB })
    expect(siteDetail.status).toBe(403)
  })

  it('被撤销网站所有权的用户不能重新授予自己网站所有权', async () => {
    const tokenA = await authToken('revoke-self-a')
    const tokenB = await authToken('revoke-self-b')

    const draftA = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Self Grant Draft' },
    })
    const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)
    const push = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
    expect(push.status).toBe(200)
    const siteId = String((push.body.site as Record<string, unknown>).siteId)

    await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
      token: tokenA,
      body: { account: 'revoke-self-b' },
    })
    await requestJson(app, 'POST', '/api/drafts', {
      token: tokenB,
      body: { name: 'B fork', siteId },
    })

    const meB = await requestJson(app, 'GET', '/api/auth/me', { token: tokenB })
    const userIdB = String((meB.body.user as Record<string, unknown>).userId)
    await requestJson(app, 'DELETE', `/api/sites/${siteId}/owners/${userIdB}`, { token: tokenA })

    const selfAdd = await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
      token: tokenB,
      body: { account: 'revoke-self-b' },
    })
    expect(selfAdd.status).toBe(403)

    const owners = await querySiteOwnerAccounts(sharedPool, siteId)
    expect(owners).not.toContain('revoke-self-b')
  })

  it('被撤销网站所有权的用户不能读取已归属网站的询盘历史', async () => {
    const tokenA = await authToken('revoke-inq-a')
    const tokenB = await authToken('revoke-inq-b')

    const draftA = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Inquiry Draft' },
    })
    const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)
    const push = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
    expect(push.status).toBe(200)
    const siteId = String((push.body.site as Record<string, unknown>).siteId)

    await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
      token: tokenA,
      body: { account: 'revoke-inq-b' },
    })
    await requestJson(app, 'POST', '/api/drafts', {
      token: tokenB,
      body: { name: 'B inq draft', siteId },
    })

    await requestJson(app, 'POST', `/api/public/${siteId}/inquiries`, {
      body: { email: 'lead@example.com' },
    })

    const meB = await requestJson(app, 'GET', '/api/auth/me', { token: tokenB })
    const userIdB = String((meB.body.user as Record<string, unknown>).userId)
    await requestJson(app, 'DELETE', `/api/sites/${siteId}/owners/${userIdB}`, { token: tokenA })

    const list = await requestJson(app, 'GET', `/api/sites/${siteId}/inquiries`, { token: tokenB })
    expect(list.status).toBe(403)
  })
})
