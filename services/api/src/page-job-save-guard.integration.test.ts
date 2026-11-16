import { afterAll, beforeEach, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser } from './test-support/http.js'
import { createDraft, createDraftPage, getDraftPageForUser, saveGeneratedDraftPageUnlocked } from './drafts-service.js'
import { createKnowledgeBase } from './collaboration-knowledge.js'
import { assertPageJobRunning, submitPageJob } from './collaboration-jobs.js'
import { recoverExpiredPageJobs } from './page-job-worker.js'
import { withDraftLock } from './draft-lock.js'

const pool = createTestPool()
beforeEach(resetTestDatabase)
afterAll(() => pool.end())

it('等待草稿锁期间已经中断的任务无法保存页面', async () => {
  const user = await registerUser(app, { account: 'save-guard', password: 'save-guard-password', name: 'Owner' })
  const userId = String(user.user.userId)
  const draft = await createDraft({ userId, name: 'Save guard' })
  const page = await createDraftPage(userId, draft.draftId, { kind: 'content', title: 'Original', slug: 'original' })
  const before = await getDraftPageForUser(userId, draft.draftId, page.pageId)
  const kb = await createKnowledgeBase(userId, 'Knowledge')
  const job = await submitPageJob({ userId, draftId: draft.draftId, knowledgeBaseId: kb.kbId, kind: 'content', title: 'Updated', slug: page.slug, operation: 'rewrite', pageId: page.pageId, expectedUpdatedAt: page.updatedAt })
  await pool.query(`UPDATE jobs SET status='running' WHERE job_id=$1`, [job.jobId])
  await assertPageJobRunning(job.jobId)
  await pool.query(`UPDATE jobs SET updated_at=NOW()-INTERVAL '11 minutes' WHERE job_id=$1`, [job.jobId])
  expect(await recoverExpiredPageJobs()).toBe(1)
  await expect(withDraftLock(draft.draftId, async () => {
    await assertPageJobRunning(job.jobId)
    return saveGeneratedDraftPageUnlocked(userId, draft.draftId, {
      kind: 'content', operation: 'rewrite', sourcePageId: page.pageId, expectedUpdatedAt: page.updatedAt,
      generated: { title: 'Updated', slug: page.slug, locale: page.locale, seo: { title: 'Updated', description: 'Updated' }, body: { html: '<main><h1>Updated</h1><p>Updated content.</p></main>' } }, generation: { jobId: job.jobId },
    })
  })).rejects.toThrow('生成任务已经中断')
  expect(await getDraftPageForUser(userId, draft.draftId, page.pageId)).toEqual(before)
})
