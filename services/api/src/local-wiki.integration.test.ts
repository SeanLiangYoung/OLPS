import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { createUser } from './users.js'
import { createKnowledgeBase, listDocuments } from './collaboration-knowledge.js'
import { importLocalWiki } from './local-wiki.js'

describe('本地知识文件导入', () => {
  const pool = createTestPool()
  beforeEach(resetTestDatabase)
  afterAll(() => pool.end())
  it('读取真实目录并同步文件内容，其他账号无权读取', async () => {
    const root = path.resolve('.intermediate', `wiki-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, 'products.md'), '# 产品资料\n产品用于工业橡胶密封。')
    const originalRoot = process.env.LLM_WIKI_ROOT
    const originalAccounts = process.env.LLM_WIKI_ALLOWED_ACCOUNTS
    process.env.LLM_WIKI_ROOT = root
    process.env.LLM_WIKI_ALLOWED_ACCOUNTS = 'wiki-owner'
    try {
      const user = await createUser({ account: 'wiki-owner', password: 'wiki-password', name: 'Owner' })
      const kb = await createKnowledgeBase(user.userId, '产品知识')
      expect((await importLocalWiki(user.userId, kb.kbId)).imported).toBe(1)
      expect((await listDocuments(user.userId, kb.kbId))[0].content).toContain('工业橡胶密封')
      await fs.writeFile(path.join(root, 'products.md'), '# 产品资料\n更新后的产品资料。')
      await importLocalWiki(user.userId, kb.kbId)
      expect((await listDocuments(user.userId, kb.kbId))[0].content).toContain('更新后的产品资料')
      const other = await createUser({ account: 'wiki-other', password: 'wiki-password', name: 'Other' })
      const otherKb = await createKnowledgeBase(other.userId, 'Other')
      await expect(importLocalWiki(other.userId, otherKb.kbId)).rejects.toThrow('FORBIDDEN')
    } finally {
      if (originalRoot === undefined) delete process.env.LLM_WIKI_ROOT
      else process.env.LLM_WIKI_ROOT = originalRoot
      if (originalAccounts === undefined) delete process.env.LLM_WIKI_ALLOWED_ACCOUNTS
      else process.env.LLM_WIKI_ALLOWED_ACCOUNTS = originalAccounts
    }
  })
})
