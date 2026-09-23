import { randomUUID } from 'node:crypto'
import { pool } from './db.js'

export type KnowledgeBase = {
  kbId: string
  tenantId: string
  name: string
  createdAt: string
  updatedAt: string
}

export type KnowledgeDocument = {
  docId: string
  kbId: string
  tenantId: string
  title: string
  content: string
  createdAt: string
}

export async function createKnowledgeBase(tenantId: string, name: string): Promise<KnowledgeBase> {
  const now = new Date().toISOString()
  const kbId = randomUUID()
  await pool.query(
    `INSERT INTO knowledge_bases(kb_id, tenant_id, name, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)`,
    [kbId, tenantId, name, now, now],
  )
  return { kbId, tenantId, name, createdAt: now, updatedAt: now }
}

export async function listKnowledgeBases(tenantId: string): Promise<KnowledgeBase[]> {
  const result = await pool.query(
    `SELECT * FROM knowledge_bases WHERE tenant_id=$1 ORDER BY created_at DESC`,
    [tenantId],
  )
  return result.rows.map((row) => ({
    kbId: String(row.kb_id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }))
}

export async function getKnowledgeBase(tenantId: string, kbId: string): Promise<KnowledgeBase | null> {
  const result = await pool.query(
    `SELECT * FROM knowledge_bases WHERE tenant_id=$1 AND kb_id=$2`,
    [tenantId, kbId],
  )
  if (!result.rowCount) return null
  const row = result.rows[0]!
  return {
    kbId: String(row.kb_id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function addDocument(input: {
  tenantId: string
  kbId: string
  title: string
  content: string
}): Promise<KnowledgeDocument> {
  const kb = await getKnowledgeBase(input.tenantId, input.kbId)
  if (!kb) throw new Error(`知识库不存在: ${input.kbId}`)
  if (!input.content.trim()) throw new Error('文档内容不能为空')
  const now = new Date().toISOString()
  const docId = randomUUID()
  await pool.query(
    `INSERT INTO knowledge_documents(doc_id, kb_id, tenant_id, title, content, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [docId, input.kbId, input.tenantId, input.title, input.content, now],
  )
  return {
    docId,
    kbId: input.kbId,
    tenantId: input.tenantId,
    title: input.title,
    content: input.content,
    createdAt: now,
  }
}

export async function listDocuments(tenantId: string, kbId: string): Promise<KnowledgeDocument[]> {
  const result = await pool.query(
    `SELECT * FROM knowledge_documents WHERE tenant_id=$1 AND kb_id=$2 ORDER BY created_at DESC`,
    [tenantId, kbId],
  )
  return result.rows.map((row) => ({
    docId: String(row.doc_id),
    kbId: String(row.kb_id),
    tenantId: String(row.tenant_id),
    title: String(row.title),
    content: String(row.content),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }))
}

/** 按 brief 关键词从知识库取相关段落，供生成使用。 */
export async function retrieveKnowledge(
  tenantId: string,
  kbId: string,
  query: string,
  limit = 5,
): Promise<string[]> {
  const docs = await listDocuments(tenantId, kbId)
  if (!docs.length) {
    throw new Error('知识库没有文档，无法继续生成')
  }
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((t) => t.length >= 2)
  const scored = docs.map((doc) => {
    const hay = `${doc.title}\n${doc.content}`.toLowerCase()
    let score = 0
    for (const token of tokens) {
      if (hay.includes(token)) score += 1
    }
    if (score === 0) score = 0.1
    return { doc, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((item) => `## ${item.doc.title}\n${item.doc.content}`)
}
