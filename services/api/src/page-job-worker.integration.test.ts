import { afterAll, beforeEach, expect, it } from 'vitest'
import { app } from './app.js'
import { registerUser } from './test-support/http.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { createDraft, createDraftPage, getDraftPageForUser, patchDraftSettings } from './drafts-service.js'
import { addDocument, createKnowledgeBase } from './collaboration-knowledge.js'
import { getJob, submitPageJob } from './collaboration-jobs.js'
import { processNextPageJob, recoverExpiredPageJobs } from './page-job-worker.js'

const pool = createTestPool()
beforeEach(resetTestDatabase)
afterAll(() => pool.end())

async function setup() {
  const user = await registerUser(app, { account: 'page-jobs-user', password: 'page-jobs-password', name: '任务用户' })
  const userId = String(user.user.userId)
  const draft = await createDraft({ userId, name: '任务测试草稿' })
  const kb = await createKnowledgeBase(userId, '任务知识')
  await addDocument(userId, kb.kbId, { title: '产品资料', content: '提供用于页面内容生成的业务知识。' })
  return { userId, draftId: draft.draftId, knowledgeBaseId: kb.kbId, kind: 'content' as const, title: '产品介绍', slug: 'product', locale: 'en' }
}

it('提交持久化 pending，并发 worker 只领取一次，缺少凭据保存失败及出处', async () => {
  delete process.env.MINIMAX_API_KEY
  const input = await setup()
  const job = await submitPageJob(input)
  expect(job.status).toBe('pending')
  const results = await Promise.all([processNextPageJob(), processNextPageJob()])
  expect(results.filter(Boolean)).toHaveLength(1)
  const failed = await getJob(input.userId, job.jobId)
  expect(failed?.status).toBe('failed')
  expect(failed?.error).toContain('MINIMAX_API_KEY')
  expect(failed?.result?.sources).toEqual(expect.arrayContaining([expect.objectContaining({ title: '产品资料', docId: expect.any(String) })]))
  expect((failed?.result?.sources as Record<string, unknown>[])[0]).not.toHaveProperty('content')
  const stored = await pool.query('SELECT result FROM jobs WHERE job_id=$1', [job.jobId])
  expect(stored.rows[0]!.result.sources[0].content).toBe('提供用于页面内容生成的业务知识。')
  expect((await pool.query('SELECT * FROM pages WHERE draft_id=$1', [input.draftId])).rowCount).toBe(0)
})

it('拒绝未授权请求和过期源页面版本，失败改写保留原页面', async () => {
  delete process.env.MINIMAX_API_KEY
  const input = await setup()
  await expect(submitPageJob({ ...input, userId: 'unowned' })).rejects.toThrow('FORBIDDEN')
  const page = await createDraftPage(input.userId, input.draftId, input)
  const before = await getDraftPageForUser(input.userId, input.draftId, page.pageId)
  await expect(submitPageJob({ ...input, operation: 'rewrite', pageId: page.pageId, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })).rejects.toThrow('VERSION_CONFLICT')
  const job = await submitPageJob({ ...input, operation: 'rewrite', pageId: page.pageId, expectedUpdatedAt: page.updatedAt })
  await processNextPageJob()
  expect((await getJob(input.userId, job.jobId))?.status).toBe('failed')
  expect(await getDraftPageForUser(input.userId, input.draftId, page.pageId)).toEqual(before)
})

it('领取任务时重新检查权限和源版本', async () => {
  const input = await setup()
  const page = await createDraftPage(input.userId, input.draftId, input)
  const stale = await submitPageJob({ ...input, operation: 'rewrite', pageId: page.pageId, expectedUpdatedAt: page.updatedAt })
  await pool.query(`UPDATE pages SET updated_at=updated_at + INTERVAL '1 second' WHERE page_id=$1`, [page.pageId])
  await processNextPageJob()
  expect((await getJob(input.userId, stale.jobId))?.error).toBe('PAGE_VERSION_CONFLICT')
  const unauthorized = await submitPageJob({ ...input, slug: 'another' })
  await pool.query('DELETE FROM draft_owners WHERE draft_id=$1 AND user_id=$2', [input.draftId, input.userId])
  await processNextPageJob()
  expect((await getJob(input.userId, unauthorized.jobId))?.error).toBe('FORBIDDEN')
})

it('已有目标语言翻译需要明确指定目标页面和版本', async () => {
  const input = await setup()
  await patchDraftSettings(input.userId, input.draftId, { locales: ['en', 'fr'] })
  const source = await createDraftPage(input.userId, input.draftId, { ...input, translationGroupId: 'product' })
  const target = await createDraftPage(input.userId, input.draftId, { ...input, slug: 'produit', locale: 'fr', translationGroupId: 'product' })
  const request = { ...input, operation: 'translate' as const, locale: 'fr', slug: 'produit', pageId: source.pageId, expectedUpdatedAt: source.updatedAt }
  await expect(submitPageJob(request)).rejects.toThrow('targetPageId')
  const job = await submitPageJob({ ...request, targetPageId: target.pageId, targetExpectedUpdatedAt: target.updatedAt })
  expect(job.status).toBe('pending')
  await expect(submitPageJob({ ...request, targetPageId: target.pageId, targetExpectedUpdatedAt: '2000-01-01T00:00:00.000Z' })).rejects.toThrow('PAGE_VERSION_CONFLICT')
})

it('过期 running 任务保存中断错误，当前任务和 pending 任务保持状态', async () => {
  const input = await setup()
  const expired = await submitPageJob(input)
  const recent = await submitPageJob({ ...input, slug: 'recent' })
  const pending = await submitPageJob({ ...input, slug: 'pending' })
  await pool.query(`UPDATE jobs SET status='running',updated_at=NOW()-INTERVAL '11 minutes' WHERE job_id=$1`, [expired.jobId])
  await pool.query(`UPDATE jobs SET status='running' WHERE job_id=$1`, [recent.jobId])
  expect(await recoverExpiredPageJobs()).toBe(1)
  expect(await recoverExpiredPageJobs()).toBe(0)
  expect((await getJob(input.userId, expired.jobId))?.status).toBe('failed')
  expect((await getJob(input.userId, expired.jobId))?.error).toContain('中断')
  expect((await getJob(input.userId, recent.jobId))?.status).toBe('running')
  expect((await getJob(input.userId, pending.jobId))?.status).toBe('pending')
})

it('提交前拒绝无法发布的 slug 和已有页面地址', async () => {
  const input = await setup()
  await expect(submitPageJob({ ...input, slug: '../product' })).rejects.toThrow('slug')
  await createDraftPage(input.userId, input.draftId, input)
  await expect(submitPageJob(input)).rejects.toThrow('slug')
})
