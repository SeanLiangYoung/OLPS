import { randomUUID } from 'node:crypto'
import type { PageKind } from '@olps/domain'
import { pool } from './db.js'
import { isDraftOwner } from './permissions.js'
import {
  createDraftPageUnlocked,
  patchDraftPageForUserUnlocked,
} from './drafts-service.js'
import { generatePageContent } from './generate.js'
import { withDraftLock } from './draft-lock.js'
import { assertDraftOrdinaryEditAllowed } from './draft-ordinary-edit-guard.js'
import { retrieveKnowledge } from './collaboration-knowledge.js'

export type JobRecord = {
  jobId: string
  userId: string
  draftId: string
  siteId: string | null
  type: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  request: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  createdAt: string
  updatedAt: string
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    jobId: String(row.job_id),
    userId: String(row.user_id),
    draftId: String(row.draft_id),
    siteId: row.site_id ? String(row.site_id) : null,
    type: String(row.type),
    status: row.status as JobRecord['status'],
    request: row.request as Record<string, unknown>,
    result: (row.result as Record<string, unknown> | null) ?? null,
    error: row.error ? String(row.error) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function runGeneratePageJob(input: {
  userId: string
  draftId: string
  knowledgeBaseId: string
  kind: PageKind
  title: string
  slug: string
  brief?: string
}): Promise<{ job: JobRecord; page?: import('@olps/domain').PageRecord }> {
  if (!(await isDraftOwner(input.userId, input.draftId))) {
    throw new Error('FORBIDDEN')
  }
  const draftRow = await pool.query(`SELECT * FROM site_drafts WHERE draft_id=$1`, [input.draftId])
  if (!draftRow.rowCount) {
    throw new Error(`草稿不存在: ${input.draftId}`)
  }
  assertDraftOrdinaryEditAllowed(draftRow.rows[0]!)
  const siteId = draftRow.rows[0]!.site_id as string | null
  const now = new Date().toISOString()
  const jobId = randomUUID()
  const request = {
    draftId: input.draftId,
    knowledgeBaseId: input.knowledgeBaseId,
    kind: input.kind,
    title: input.title,
    slug: input.slug,
    brief: input.brief ?? '',
  }
  await pool.query(
    `INSERT INTO jobs(job_id, user_id, draft_id, site_id, type, status, request, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'generate_page','running',$5::jsonb,$6,$7)`,
    [jobId, input.userId, input.draftId, siteId, JSON.stringify(request), now, now],
  )
  try {
    const brief = input.brief ?? input.title
    const snippets = await retrieveKnowledge(input.userId, input.knowledgeBaseId, brief)
    const generated = generatePageContent({
      kind: input.kind,
      title: input.title,
      slug: input.slug,
      brief: `${brief}\n\n${snippets.join('\n\n')}`,
      locale: 'en',
    })
    const updated = await withDraftLock(input.draftId, async () => {
      const page = await createDraftPageUnlocked(input.userId, input.draftId, {
        kind: input.kind,
        title: generated.title,
        slug: generated.slug,
        locale: generated.locale,
      })
      return patchDraftPageForUserUnlocked(input.userId, input.draftId, page.pageId, {
        title: generated.title,
        slug: generated.slug,
        seo: generated.seo,
        body: generated.body,
      })
    })
    const result = { pageId: updated.pageId, page: updated }
    const doneAt = new Date().toISOString()
    await pool.query(
      `UPDATE jobs SET status='completed', result=$1::jsonb, updated_at=$2 WHERE job_id=$3`,
      [JSON.stringify(result), doneAt, jobId],
    )
    const job = await getJob(input.userId, jobId)
    if (!job) {
      throw new Error(`Job 不存在: ${jobId}`)
    }
    return { job: job, page: updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const failedAt = new Date().toISOString()
    await pool.query(
      `UPDATE jobs SET status='failed', error=$1, updated_at=$2 WHERE job_id=$3`,
      [message, failedAt, jobId],
    )
    throw err
  }
}

export async function getJob(userId: string, jobId: string): Promise<JobRecord | null> {
  const result = await pool.query(`SELECT * FROM jobs WHERE job_id=$1 AND user_id=$2`, [
    jobId,
    userId,
  ])
  if (!result.rowCount) return null
  return mapJob(result.rows[0]!)
}
