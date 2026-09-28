import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { reindexPagesFromSandbox } from './drafts-service.js'
import { openDraftWorkspace } from './workspace-factory.js'
import { readPageFromWorkspace, writePageToWorkspace } from './page-sandbox.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'

type PageRow = Record<string, unknown>

function serializePages(rows: PageRow[]): string {
  const normalized = rows
    .map((row) => ({
      page_id: String(row.page_id),
      draft_id: String(row.draft_id),
      site_id: row.site_id == null ? null : String(row.site_id),
      kind: String(row.kind),
      slug: String(row.slug),
      title: String(row.title),
      status: String(row.status),
      locale: String(row.locale),
      seo: row.seo,
      body: row.body,
      created_at: new Date(String(row.created_at)).toISOString(),
      updated_at: new Date(String(row.updated_at)).toISOString(),
      published_at:
        row.published_at == null ? null : new Date(String(row.published_at)).toISOString(),
    }))
    .sort((a, b) => a.page_id.localeCompare(b.page_id))
  return JSON.stringify(normalized)
}

describe('reindexPagesFromSandbox 数据库事务（真实 PG 约束）', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    requireRemoteServiceConfig()
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  it('违反 UNIQUE(draft_id, slug) 时整次 reindex 失败且 pages 行集与全部字段保持不变', async () => {
    const reg = await registerUser(app, {
      account: 'reindex-tx-user',
      password: 'reindex-tx-pass',
      name: 'reindex-tx-user',
    })
    expect(reg.status).toBe(201)
    const token = reg.accessToken

    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Reindex TX Draft' },
    })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    const pageA = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token,
      body: { kind: 'content', title: 'Page Alpha', slug: 'alpha-slug' },
    })
    expect(pageA.status).toBe(201)
    const pageAId = String((pageA.body.page as Record<string, unknown>).pageId)

    const pageB = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token,
      body: { kind: 'content', title: 'Page Beta', slug: 'beta-slug' },
    })
    expect(pageB.status).toBe(201)
    const pageBId = String((pageB.body.page as Record<string, unknown>).pageId)

    const beforeRows = await pool.query(`SELECT * FROM pages WHERE draft_id=$1`, [draftId])
    const beforeSnapshot = serializePages(beforeRows.rows as PageRow[])

    const [firstId, secondId] = [pageAId, pageBId].sort()
    const draftRow = await pool.query(`SELECT * FROM site_drafts WHERE draft_id=$1`, [draftId])
    const row = draftRow.rows[0]!
    const workspace = await openDraftWorkspace({
      draftId,
      sandboxId: String(row.sandbox_id),
      siteId: row.site_id ? String(row.site_id) : null,
      baseCommitId: row.base_commit_id ? String(row.base_commit_id) : null,
      headCommitId: row.head_commit_id ? String(row.head_commit_id) : null,
    })

    const firstJson = await readPageFromWorkspace(workspace, firstId)
    const secondJson = await readPageFromWorkspace(workspace, secondId)
    if (!firstJson || !secondJson) {
      throw new Error('sandbox 页面缺失')
    }

    await writePageToWorkspace(workspace, {
      ...firstJson,
      title: 'First Page Valid Title Update',
    })
    await writePageToWorkspace(workspace, {
      ...secondJson,
      slug: firstJson.slug,
    })

    await expect(reindexPagesFromSandbox(draftId, workspace)).rejects.toBeTruthy()

    const afterRows = await pool.query(`SELECT * FROM pages WHERE draft_id=$1`, [draftId])
    const afterSnapshot = serializePages(afterRows.rows as PageRow[])
    expect(afterSnapshot).toBe(beforeSnapshot)
  })
})
