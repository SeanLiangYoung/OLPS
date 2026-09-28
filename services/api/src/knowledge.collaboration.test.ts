import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { columnExists } from './test-support/schema.js'
import { registerUser, requestJson } from './test-support/http.js'

describe('知识库用户归属与授权', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function token(account: string): Promise<string> {
    const reg = await registerUser(app, {
      account,
      password: 'kb-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  it('用户创建的知识库仅创建者默认可访问', async () => {
    const tokenA = await token('kb-owner')
    const created = await requestJson(app, 'POST', '/api/knowledge-bases', {
      token: tokenA,
      body: { name: 'Private KB' },
    })
    expect(created.status).toBe(201)
    const kbId = String((created.body.knowledgeBase as Record<string, unknown>).kbId)

    const tokenB = await token('kb-stranger')
    const docs = await requestJson(app, 'GET', `/api/knowledge-bases/${kbId}/documents`, {
      token: tokenB,
    })
    expect(docs.status).toBe(403)
  })

  it('授权后其他用户可读取文档列表', async () => {
    const tokenA = await token('kb-grant-owner')
    const created = await requestJson(app, 'POST', '/api/knowledge-bases', {
      token: tokenA,
      body: { name: 'Shared KB' },
    })
    const kbId = String((created.body.knowledgeBase as Record<string, unknown>).kbId)

    await requestJson(app, 'POST', `/api/knowledge-bases/${kbId}/documents`, {
      token: tokenA,
      body: { title: 'Doc', content: 'Body text' },
    })

    const tokenB = await token('kb-grantee')
    const grant = await requestJson(app, 'POST', `/api/knowledge-bases/${kbId}/grants`, {
      token: tokenA,
      body: { account: 'kb-grantee' },
    })
    expect(grant.status).toBe(200)

    const docs = await requestJson(app, 'GET', `/api/knowledge-bases/${kbId}/documents`, {
      token: tokenB,
    })
    expect(docs.status).toBe(200)
    const documents = docs.body.documents as Array<Record<string, unknown>>
    expect(documents.length).toBe(1)
  })

  it('知识库记录 owner_user_id 而非 tenant_id', async () => {
    const tokenA = await token('kb-db')
    const created = await requestJson(app, 'POST', '/api/knowledge-bases', {
      token: tokenA,
      body: { name: 'Db KB' },
    })
    const kbId = String((created.body.knowledgeBase as Record<string, unknown>).kbId)
    const row = await pool.query(`SELECT owner_user_id FROM knowledge_bases WHERE kb_id=$1`, [kbId])
    expect(row.rowCount).toBe(1)
    expect(row.rows[0]!.owner_user_id).toBeTruthy()
    expect(await columnExists(pool, 'knowledge_bases', 'tenant_id')).toBe(false)
  })
})
