import { randomUUID } from 'node:crypto'
import type { PageKind, PageRecord } from '@olps/domain'
import { pool } from './db.js'
import { isDraftOwner } from './permissions.js'
import {
  createDraftPageUnlocked,
  getDraftForUser,
  getDraftPageForUser,
  listDraftPages,
  patchDraftPageForUser,
  patchDraftPageForUserUnlocked,
} from './drafts-service.js'
import { generatePageContent, revisePageContent, type SitePageLink } from './generate.js'
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

type PageJobType = 'generate_page' | 'revise_page'

/** 记录一次写页面的 Job：先校验权限与草稿状态，再执行 work，按结果把 Job 标为 completed 或 failed。 */
async function runPageJob(
  input: { userId: string; draftId: string; type: PageJobType; request: Record<string, unknown> },
  work: () => Promise<PageRecord>,
): Promise<{ job: JobRecord; page: PageRecord }> {
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
  await pool.query(
    `INSERT INTO jobs(job_id, user_id, draft_id, site_id, type, status, request, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'running',$6::jsonb,$7,$8)`,
    [jobId, input.userId, input.draftId, siteId, input.type, JSON.stringify(input.request), now, now],
  )
  try {
    const page = await work()
    const result = { pageId: page.pageId, page }
    await pool.query(
      `UPDATE jobs SET status='completed', result=$1::jsonb, updated_at=$2 WHERE job_id=$3`,
      [JSON.stringify(result), new Date().toISOString(), jobId],
    )
    const job = await getJob(input.userId, jobId)
    if (!job) {
      throw new Error(`Job 不存在: ${jobId}`)
    }
    return { job, page }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await pool.query(
      `UPDATE jobs SET status='failed', error=$1, updated_at=$2 WHERE job_id=$3`,
      [message, new Date().toISOString(), jobId],
    )
    throw err
  }
}

async function listSitePageLinks(userId: string, draftId: string, excludePageId?: string): Promise<SitePageLink[]> {
  const pages = await listDraftPages(userId, draftId)
  return pages
    .filter((p) => p.pageId !== excludePageId)
    .map((p) => ({ title: p.title, slug: p.slug }))
}

async function requireDraftLocale(userId: string, draftId: string): Promise<string> {
  const draft = await getDraftForUser(userId, draftId)
  if (!draft) {
    throw new Error('FORBIDDEN')
  }
  return draft.settings.defaultLocale
}

export async function runGeneratePageJob(input: {
  userId: string
  draftId: string
  knowledgeBaseId?: string
  kind: PageKind
  title: string
  slug: string
  brief: string
}): Promise<{ job: JobRecord; page: PageRecord }> {
  const request = {
    draftId: input.draftId,
    knowledgeBaseId: input.knowledgeBaseId ?? null,
    kind: input.kind,
    title: input.title,
    slug: input.slug,
    brief: input.brief,
  }
  return runPageJob(
    { userId: input.userId, draftId: input.draftId, type: 'generate_page', request },
    async () => {
      const locale = await requireDraftLocale(input.userId, input.draftId)
      const knowledge = input.knowledgeBaseId
        ? await retrieveKnowledge(input.userId, input.knowledgeBaseId, `${input.title}\n${input.brief}`)
        : []
      const generated = await generatePageContent({
        kind: input.kind,
        title: input.title,
        slug: input.slug,
        brief: input.brief,
        locale,
        knowledge,
        sitePages: await listSitePageLinks(input.userId, input.draftId),
      })
      return withDraftLock(input.draftId, async () => {
        const page = await createDraftPageUnlocked(input.userId, input.draftId, {
          kind: input.kind,
          title: input.title,
          slug: input.slug,
          locale,
        })
        return patchDraftPageForUserUnlocked(input.userId, input.draftId, page.pageId, {
          seo: generated.seo,
          body: { html: generated.html },
        })
      })
    },
  )
}

export async function runRevisePageJob(input: {
  userId: string
  draftId: string
  pageId: string
  instruction: string
}): Promise<{ job: JobRecord; page: PageRecord }> {
  const request = {
    draftId: input.draftId,
    pageId: input.pageId,
    instruction: input.instruction,
  }
  return runPageJob(
    { userId: input.userId, draftId: input.draftId, type: 'revise_page', request },
    async () => {
      const page = await getDraftPageForUser(input.userId, input.draftId, input.pageId)
      if (!page) {
        throw new Error('NOT_FOUND')
      }
      const revised = await revisePageContent({
        kind: page.kind,
        title: page.title,
        slug: page.slug,
        locale: page.locale,
        seo: page.seo,
        html: page.body.html,
        instruction: input.instruction,
        sitePages: await listSitePageLinks(input.userId, input.draftId, input.pageId),
      })
      return patchDraftPageForUser(input.userId, input.draftId, input.pageId, {
        seo: revised.seo,
        body: { ...page.body, html: revised.html },
      })
    },
  )
}

export async function getJob(userId: string, jobId: string): Promise<JobRecord | null> {
  const result = await pool.query(`SELECT * FROM jobs WHERE job_id=$1 AND user_id=$2`, [
    jobId,
    userId,
  ])
  if (!result.rowCount) return null
  return mapJob(result.rows[0]!)
}
