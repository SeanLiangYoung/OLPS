import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import glob from 'fast-glob'
import { pool } from './db.js'
import { canAccessKb } from './collaboration-knowledge.js'

export async function localWikiStatus(userId: string, kbId: string) {
  if (!(await canAccessKb(userId, kbId))) throw new Error('FORBIDDEN')
  const user = await pool.query('SELECT account FROM users WHERE user_id=$1', [userId])
  const allowed = (process.env.LLM_WIKI_ALLOWED_ACCOUNTS ?? '').split(',').map(value => value.trim()).filter(Boolean)
  return { configured: Boolean(process.env.LLM_WIKI_ROOT?.trim()), allowed: allowed.includes(String(user.rows[0]?.account)) }
}

export async function importLocalWiki(userId: string, kbId: string) {
  const status = await localWikiStatus(userId, kbId)
  const kb = await pool.query('SELECT owner_user_id FROM knowledge_bases WHERE kb_id=$1', [kbId])
  if (!status.allowed || kb.rows[0]?.owner_user_id !== userId) throw new Error('FORBIDDEN')
  if (!status.configured) throw new Error('缺少 LLM_WIKI_ROOT 本地知识目录配置')
  const root = await fs.realpath(process.env.LLM_WIKI_ROOT!.trim())
  const files = await glob(['**/*.md', '**/*.markdown', '**/*.txt'], { cwd: root, onlyFiles: true, followSymbolicLinks: false, ignore: ['**/node_modules/**', '**/.git/**'] })
  const docs = []
  for (const file of files.sort()) {
    const absolute = await fs.realpath(path.join(root, file))
    if (!absolute.startsWith(root + path.sep)) throw new Error('知识文件超出配置目录')
    if ((await fs.stat(absolute)).size > 2 * 1024 * 1024) throw new Error(`知识文件超过 2 MiB：${file}`)
    const content = await fs.readFile(absolute, 'utf8')
    if (!content.trim()) continue
    docs.push({ source: `llm-wiki:${file}`, title: path.basename(file, path.extname(file)), content })
  }
  if (!docs.length) throw new Error('知识目录中没有可读取的文档')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const doc of docs) {
      await client.query(
        `INSERT INTO knowledge_documents(doc_id,kb_id,title,content,source,created_at) VALUES($1,$2,$3,$4,$5,NOW())
         ON CONFLICT(kb_id,source) WHERE source IS NOT NULL DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content`,
        [randomUUID(),kbId,doc.title,doc.content,doc.source],
      )
    }
    await client.query(`DELETE FROM knowledge_documents WHERE kb_id=$1 AND source LIKE 'llm-wiki:%' AND NOT(source=ANY($2::text[]))`, [kbId,docs.map(doc => doc.source)])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  return { imported: docs.length }
}
