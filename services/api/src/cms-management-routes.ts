import { Hono } from 'hono'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { KnowledgeDocumentWriteError, writeKnowledgeManualDocument } from './knowledge-service-client.js'
import { pool } from './db.js'
import { getAuthUser, requireAuth, type AuthVariables } from './auth-middleware.js'
import { createCmsDraft } from './cms-drafts.js'

export const cmsManagementRoutes = new Hono<{ Variables: AuthVariables }>()

function draftRecord(row: Record<string, unknown>): Record<string, unknown> {
  return { draftId: row.draft_id, siteId: row.site_id, name: row.name, sandboxId: row.sandbox_id, status: row.status, initStatus: row.init_status, syncStatus: row.sync_status, baseCommitId: row.base_commit_id, headCommitId: row.head_commit_id, error: row.last_error }
}

cmsManagementRoutes.get('/drafts', requireAuth, async c => {
  const result = await pool.query('SELECT d.* FROM site_drafts d JOIN draft_owners o USING(draft_id) WHERE o.user_id=$1 ORDER BY d.created_at DESC', [getAuthUser(c).userId])
  return c.json({ drafts: result.rows.map(draftRecord) })
})
cmsManagementRoutes.get('/drafts/:draftId', requireAuth, async c => {
  const result = await pool.query('SELECT d.* FROM site_drafts d JOIN draft_owners o USING(draft_id) WHERE d.draft_id=$1 AND o.user_id=$2', [c.req.param('draftId'), getAuthUser(c).userId])
  if (!result.rowCount) return c.json({ error: '没有编辑版本访问权限', code: 'FORBIDDEN' }, 403)
  return c.json({ draft: draftRecord(result.rows[0]) })
})

cmsManagementRoutes.post('/drafts', requireAuth, async c => {
  const input = z.object({ siteId: z.string().uuid(), name: z.string().trim().min(1).max(200) }).strict().safeParse(await c.req.json())
  if (!input.success) return c.json({ error: '请填写网站和编辑版本名称', code: 'VALIDATION_FAILED', details: input.error.issues }, 400)
  try { return c.json({ draft: await createCmsDraft(getAuthUser(c).userId, input.data.siteId, input.data.name) }, 201) }
  catch (error) {
    if (error instanceof Error && error.message === 'FORBIDDEN') return c.json({ error: '没有网站管理权限', code: 'FORBIDDEN' }, 403)
    if (error instanceof Error && error.message === 'DRAFT_NOT_READY') return c.json({ error: '网站尚未完成初始化', code: 'DRAFT_NOT_READY' }, 409)
    throw error
  }
})

function siteRecord(row: Record<string, unknown>): Record<string, unknown> {
  return { siteId: row.site_id, name: row.name, status: row.status, settings: row.settings, publicUrl: row.public_url, publishedCommitId: row.published_commit_id, createdAt: row.created_at, updatedAt: row.updated_at }
}

cmsManagementRoutes.get('/sites', requireAuth, async c => {
  const result = await pool.query('SELECT s.* FROM sites s JOIN site_owners o USING(site_id) WHERE o.user_id=$1 ORDER BY s.created_at DESC', [getAuthUser(c).userId])
  return c.json({ sites: result.rows.map(siteRecord) })
})

cmsManagementRoutes.get('/sites/:siteId', requireAuth, async c => {
  const result = await pool.query('SELECT s.* FROM sites s JOIN site_owners o USING(site_id) WHERE s.site_id=$1 AND o.user_id=$2', [c.req.param('siteId'), getAuthUser(c).userId])
  if (!result.rowCount) return c.json({ code: 'NOT_FOUND', error: '网站不存在' }, 404)
  return c.json({ site: siteRecord(result.rows[0]) })
})

cmsManagementRoutes.get('/sites/:siteId/drafts', requireAuth, async c => {
  const result = await pool.query(`SELECT d.* FROM site_drafts d JOIN draft_owners o USING(draft_id)
    JOIN site_owners so ON so.site_id=d.site_id AND so.user_id=o.user_id WHERE d.site_id=$1 AND o.user_id=$2 ORDER BY d.created_at DESC`, [c.req.param('siteId'), getAuthUser(c).userId])
  return c.json({ drafts: result.rows.map(row => ({ draftId: row.draft_id, siteId: row.site_id, name: row.name, status: row.status, initStatus: row.init_status, syncStatus: row.sync_status, error: row.last_error })) })
})

async function knowledgeBase(siteId: string, userId: string) {
  const result = await pool.query('SELECT k.* FROM knowledge_bases k JOIN site_owners o USING(site_id) WHERE k.site_id=$1 AND o.user_id=$2', [siteId, userId])
  return result.rows[0] as Record<string, unknown> | undefined
}
const documentSchema = z.object({ title: z.string().trim().min(1), content: z.string().min(1) }).strict()

cmsManagementRoutes.get('/sites/:siteId/knowledge-base', requireAuth, async c => {
  const record = await knowledgeBase(c.req.param('siteId')!, getAuthUser(c).userId)
  if (!record) return c.json({ code: 'NOT_FOUND', error: '知识库不存在' }, 404)
  return c.json({ knowledgeBase: { knowledgeBaseId: record.kb_id, siteId: record.site_id, name: record.name } })
})

cmsManagementRoutes.get('/sites/:siteId/knowledge-base/documents', requireAuth, async c => {
  const record = await knowledgeBase(c.req.param('siteId')!, getAuthUser(c).userId)
  if (!record) return c.json({ code: 'NOT_FOUND', error: '知识库不存在' }, 404)
  const result = await pool.query('SELECT * FROM knowledge_documents WHERE kb_id=$1 ORDER BY created_at DESC', [record.kb_id])
  return c.json({
    documents: result.rows.map(row => ({
      documentId: row.doc_id,
      title: row.title,
      content: row.content,
      createdAt: row.created_at,
      kind: row.kind,
      sourcePath: row.source_path,
    })),
  })
})

cmsManagementRoutes.post('/sites/:siteId/knowledge-base/documents', requireAuth, async c => {
  const record = await knowledgeBase(c.req.param('siteId')!, getAuthUser(c).userId)
  if (!record) return c.json({ code: 'NOT_FOUND', error: '知识库不存在' }, 404)
  const input = documentSchema.safeParse(await c.req.json())
  if (!input.success) return c.json({ code: 'VALIDATION_FAILED', error: '资料标题和正文不能为空', details: input.error.issues }, 400)
  const siteId = c.req.param('siteId')!
  const documentId = randomUUID()
  try {
    await writeKnowledgeManualDocument({
      siteId,
      action: 'create',
      documentId,
      title: input.data.title,
      content: input.data.content,
    })
  } catch (error) {
    if (error instanceof KnowledgeDocumentWriteError) {
      if (error.code === 'document_exists') {
        return c.json({ code: 'CONFLICT', error: '资料已存在' }, 409)
      }
      if (error.code === 'project_not_found') {
        return c.json({ code: 'NOT_FOUND', error: '知识库项目不存在' }, 404)
      }
      return c.json({ code: 'KNOWLEDGE_WRITE_FAILED', error: '知识库写入失败' }, 502)
    }
    throw error
  }
  return c.json({ document: { documentId, ...input.data } }, 201)
})

cmsManagementRoutes.get('/sites/:siteId/knowledge-base/documents/:documentId', requireAuth, async c => {
  const record = await knowledgeBase(c.req.param('siteId')!, getAuthUser(c).userId)
  if (!record) return c.json({ code: 'NOT_FOUND', error: '知识库不存在' }, 404)
  const result = await pool.query('SELECT * FROM knowledge_documents WHERE kb_id=$1 AND doc_id=$2', [record.kb_id, c.req.param('documentId')])
  if (!result.rowCount) return c.json({ code: 'NOT_FOUND', error: '资料不存在' }, 404)
  return c.json({ document: { documentId: result.rows[0].doc_id, title: result.rows[0].title, content: result.rows[0].content } })
})

cmsManagementRoutes.put('/sites/:siteId/knowledge-base/documents/:documentId', requireAuth, async c => {
  const record = await knowledgeBase(c.req.param('siteId')!, getAuthUser(c).userId)
  if (!record) return c.json({ code: 'NOT_FOUND', error: '知识库不存在' }, 404)
  const input = documentSchema.safeParse(await c.req.json())
  if (!input.success) return c.json({ code: 'VALIDATION_FAILED', error: '资料标题和正文不能为空', details: input.error.issues }, 400)
  const siteId = c.req.param('siteId')!
  const documentId = c.req.param('documentId')!
  const existing = await pool.query('SELECT doc_id FROM knowledge_documents WHERE doc_id=$1 AND kb_id=$2', [documentId, record.kb_id])
  if (!existing.rowCount) return c.json({ code: 'NOT_FOUND', error: '资料不存在' }, 404)
  try {
    await writeKnowledgeManualDocument({
      siteId,
      action: 'update',
      documentId,
      title: input.data.title,
      content: input.data.content,
    })
  } catch (error) {
    if (error instanceof KnowledgeDocumentWriteError) {
      if (error.code === 'document_not_found') {
        return c.json({ code: 'NOT_FOUND', error: '资料不存在' }, 404)
      }
      return c.json({ code: 'KNOWLEDGE_WRITE_FAILED', error: '知识库写入失败' }, 502)
    }
    throw error
  }
  return c.json({ document: { documentId, ...input.data } })
})

cmsManagementRoutes.delete('/sites/:siteId/knowledge-base/documents/:documentId', requireAuth, async c => {
  const record = await knowledgeBase(c.req.param('siteId')!, getAuthUser(c).userId)
  if (!record) return c.json({ code: 'NOT_FOUND', error: '知识库不存在' }, 404)
  const siteId = c.req.param('siteId')!
  const documentId = c.req.param('documentId')!
  const existing = await pool.query('SELECT doc_id FROM knowledge_documents WHERE doc_id=$1 AND kb_id=$2', [documentId, record.kb_id])
  if (!existing.rowCount) return c.json({ code: 'NOT_FOUND', error: '资料不存在' }, 404)
  try {
    await writeKnowledgeManualDocument({
      siteId,
      action: 'delete',
      documentId,
    })
  } catch (error) {
    if (error instanceof KnowledgeDocumentWriteError) {
      if (error.code === 'document_not_found') {
        return c.json({ code: 'NOT_FOUND', error: '资料不存在' }, 404)
      }
      return c.json({ code: 'KNOWLEDGE_WRITE_FAILED', error: '知识库写入失败' }, 502)
    }
    throw error
  }
  return c.body(null, 204)
})
