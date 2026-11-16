import { randomUUID } from 'node:crypto'
import { pool } from './db.js'

export type KnowledgeBaseRecord = {
  kbId: string
  ownerUserId: string
  name: string
  createdAt: string
  updatedAt: string
}

export type KnowledgeDocumentRecord = {
  source?: string
  docId: string
  kbId: string
  title: string
  content: string
  createdAt: string
}

async function getKb(kbId: string): Promise<KnowledgeBaseRecord | null> {
  const result = await pool.query(`SELECT * FROM knowledge_bases WHERE kb_id=$1`, [kbId])
  if (!result.rowCount) return null
  const row = result.rows[0]!
  return {
    kbId: String(row.kb_id),
    ownerUserId: String(row.owner_user_id),
    name: String(row.name),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function canAccessKb(userId: string, kbId: string): Promise<boolean> {
  const kb = await getKb(kbId)
  if (!kb) return false
  if (kb.ownerUserId === userId) return true
  const grant = await pool.query(
    `SELECT 1 FROM knowledge_base_grants WHERE kb_id=$1 AND user_id=$2`,
    [kbId, userId],
  )
  return (grant.rowCount ?? 0) > 0
}

export async function createKnowledgeBase(userId: string, name: string): Promise<KnowledgeBaseRecord> {
  const now = new Date().toISOString()
  const kbId = randomUUID()
  await pool.query(
    `INSERT INTO knowledge_bases(kb_id, owner_user_id, name, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [kbId, userId, name, now, now],
  )
  return { kbId, ownerUserId: userId, name, createdAt: now, updatedAt: now }
}

export async function listKnowledgeBases(userId: string): Promise<KnowledgeBaseRecord[]> {
  const result = await pool.query(
    `SELECT DISTINCT kb.* FROM knowledge_bases kb
     LEFT JOIN knowledge_base_grants g ON g.kb_id=kb.kb_id
     WHERE kb.owner_user_id=$1 OR g.user_id=$1
     ORDER BY kb.created_at DESC`,
    [userId],
  )
  return result.rows.map((row) => ({
    kbId: String(row.kb_id),
    ownerUserId: String(row.owner_user_id),
    name: String(row.name),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }))
}

export async function addDocument(
  userId: string,
  kbId: string,
  input: { title: string; content: string },
): Promise<KnowledgeDocumentRecord> {
  if (!(await canAccessKb(userId, kbId))) {
    throw new Error('FORBIDDEN')
  }
  const kb = await getKb(kbId)
  if (!kb || kb.ownerUserId !== userId) {
    throw new Error('FORBIDDEN')
  }
  if (!input.content.trim()) {
    throw new Error('文档内容不能为空')
  }
  const now = new Date().toISOString()
  const docId = randomUUID()
  await pool.query(
    `INSERT INTO knowledge_documents(doc_id, kb_id, title, content, created_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [docId, kbId, input.title, input.content, now],
  )
  return { docId, kbId, title: input.title, content: input.content, createdAt: now }
}

export async function listDocuments(userId: string, kbId: string): Promise<KnowledgeDocumentRecord[]> {
  if (!(await canAccessKb(userId, kbId))) {
    throw new Error('FORBIDDEN')
  }
  const result = await pool.query(
    `SELECT * FROM knowledge_documents WHERE kb_id=$1 ORDER BY created_at DESC`,
    [kbId],
  )
  return result.rows.map((row) => ({
    docId: String(row.doc_id),
    source: row.source ? String(row.source) : undefined,
    kbId: String(row.kb_id),
    title: String(row.title),
    content: String(row.content),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }))
}

export async function grantKbAccess(
  ownerUserId: string,
  kbId: string,
  account: string,
): Promise<void> {
  const kb = await getKb(kbId)
  if (!kb || kb.ownerUserId !== ownerUserId) {
    throw new Error('FORBIDDEN')
  }
  const user = await pool.query(`SELECT user_id FROM users WHERE account=$1`, [account])
  if (!user.rowCount) {
    throw new Error(`用户不存在: ${account}`)
  }
  const granteeId = String(user.rows[0]!.user_id)
  const now = new Date().toISOString()
  await pool.query(
    `INSERT INTO knowledge_base_grants(kb_id, user_id, created_at) VALUES ($1,$2,$3)
     ON CONFLICT DO NOTHING`,
    [kbId, granteeId, now],
  )
}

export async function retrieveKnowledgeDocuments(
  userId: string,
  kbId: string,
  query: string,
  limit = 5,
): Promise<KnowledgeDocumentRecord[]> {
  const docs = await listDocuments(userId, kbId)
  if (!docs.length) {
    return []
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
  return scored.slice(0, limit).map(item => item.doc)
}

export async function retrieveKnowledge(userId: string, kbId: string, query: string, limit = 5): Promise<string[]> {
  return (await retrieveKnowledgeDocuments(userId, kbId, query, limit)).map(doc => `## ${doc.title}\n${doc.content}`)
}
