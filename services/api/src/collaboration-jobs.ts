import { randomUUID, createHash } from 'node:crypto'
import type { PageKind, PageRecord } from '@olps/domain'
import { pool } from './db.js'
import { isDraftOwner } from './permissions.js'
import { getDraftForUser, getDraftPageForUser, listDraftPages, saveGeneratedDraftPageUnlocked } from './drafts-service.js'
import { generateModelPage } from './model-page-generation.js'
import { withDraftLock } from './draft-lock.js'
import { assertDraftOrdinaryEditAllowed } from './draft-ordinary-edit-guard.js'
import { canAccessKb, retrieveKnowledgeDocuments } from './collaboration-knowledge.js'
import { createRewriteProposal } from './page-rewrite-proposal.js'

export type PageJobInput = {
  userId: string; draftId: string; knowledgeBaseId: string; kind: PageKind; title: string; slug: string
  brief?: string; keywords?: string[]; locale?: string
  operation?: 'generate' | 'rewrite' | 'translate'
  pageId?: string; expectedUpdatedAt?: string
  targetPageId?: string; targetExpectedUpdatedAt?: string
  reviewBeforeSave?: boolean
}

export type JobRecord = {
  jobId: string; userId: string; draftId: string; siteId: string | null; type: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  request: Record<string, unknown>; result: Record<string, unknown> | null; error: string | null
  createdAt: string; updatedAt: string
}

export function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    jobId: String(row.job_id), userId: String(row.user_id), draftId: String(row.draft_id),
    siteId: row.site_id ? String(row.site_id) : null, type: String(row.type), status: row.status as JobRecord['status'],
    request: row.request as Record<string, unknown>, result: row.result as Record<string, unknown> | null,
    error: row.error ? String(row.error) : null,
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

async function checkInput(input: PageJobInput): Promise<{ source?: PageRecord; siteId: string | null; locale: string; screenCap: number }> {
  if (!(await isDraftOwner(input.userId, input.draftId))) throw new Error('FORBIDDEN')
  const row = await pool.query('SELECT * FROM site_drafts WHERE draft_id=$1', [input.draftId])
  if (!row.rowCount) throw new Error('NOT_FOUND')
  assertDraftOrdinaryEditAllowed(row.rows[0]!)
  const draft = await getDraftForUser(input.userId, input.draftId)
  if (!draft) throw new Error('NOT_FOUND')
  const operation = input.operation ?? 'generate'
  if (!['generate', 'rewrite', 'translate'].includes(operation)) throw new Error('operation 无效')
  if (!['site', 'content', 'ads'].includes(input.kind) || !input.title.trim() || !input.slug.trim()) throw new Error('页面类型、标题和 slug 必填')
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(input.slug)) throw new Error('slug 需要使用字母、数字及连接符')
  let source: PageRecord | undefined
  if (operation !== 'generate') {
    if (!input.pageId || !input.expectedUpdatedAt) throw new Error('改写和翻译需要 pageId 和 expectedUpdatedAt')
    source = (await getDraftPageForUser(input.userId, input.draftId, input.pageId)) ?? undefined
    if (!source) throw new Error('NOT_FOUND')
    if (source.updatedAt !== input.expectedUpdatedAt) throw new Error('PAGE_VERSION_CONFLICT')
    if (source.kind !== input.kind) throw new Error('页面类型必须与源页面一致')
  }
  const locale = operation === 'rewrite' ? source!.locale : input.locale || draft.settings.defaultLocale
  if (!draft.settings.locales.includes(locale)) throw new Error('目标语言需要存在于草稿语言设置')
  if (operation === 'translate' && source?.locale === locale) throw new Error('翻译目标语言必须与源语言不同')
  const pages = await listDraftPages(input.userId, input.draftId)
  if (operation === 'translate' && source?.translationGroupId && !input.targetPageId) {
    if (pages.some(page => page.translationGroupId === source.translationGroupId && page.locale === locale)) throw new Error('已有目标语言翻译，需要明确指定 targetPageId 和版本')
  }
  const destinationId = operation === 'rewrite' ? input.pageId : input.targetPageId
  if (pages.some(page => page.pageId !== destinationId && page.slug.toLowerCase() === input.slug.toLowerCase())) throw new Error('slug 已被其他页面使用')
  if (input.targetPageId) {
    if (operation !== 'translate' || !input.targetExpectedUpdatedAt) throw new Error('更新已有翻译需要 targetExpectedUpdatedAt')
    const target = await getDraftPageForUser(input.userId, input.draftId, input.targetPageId)
    if (!target) throw new Error('NOT_FOUND')
    if (target.updatedAt !== input.targetExpectedUpdatedAt) throw new Error('PAGE_VERSION_CONFLICT')
    if (target.locale !== locale || target.kind !== input.kind || !source?.translationGroupId || target.translationGroupId !== source.translationGroupId) throw new Error('目标页面需要属于同一翻译组及目标语言')
  }
  if (!(await canAccessKb(input.userId, input.knowledgeBaseId))) throw new Error('FORBIDDEN')
  return { source, siteId: draft.siteId, locale, screenCap: draft.settings.screenCap }
}

export async function submitPageJob(input: PageJobInput): Promise<JobRecord> {
  return withDraftLock(input.draftId, async () => {
    const checked = await checkInput(input)
    const request = { ...input, locale: checked.locale, operation: input.operation ?? 'generate' }
    const now = new Date().toISOString()
    const result = await pool.query(
      `INSERT INTO jobs(job_id,user_id,draft_id,site_id,type,status,request,result,created_at,updated_at)
       VALUES($1,$2,$3,$4,'generate_page','pending',$5::jsonb,$6::jsonb,$7,$7) RETURNING *`,
      [randomUUID(), input.userId, input.draftId, checked.siteId, JSON.stringify(request), JSON.stringify({ progress: 0, stage: 'pending' }), now],
    )
    return mapJob(result.rows[0]!)
  })
}

export async function assertPageJobRunning(jobId: string): Promise<void> {
  const active = await pool.query(`UPDATE jobs SET updated_at=NOW() WHERE job_id=$1 AND status='running' RETURNING job_id`, [jobId])
  if (!active.rowCount) throw new Error('生成任务已经中断')
}

export async function processClaimedPageJob(job: JobRecord): Promise<void> {
  const input = { ...job.request, userId: job.userId, draftId: job.draftId } as PageJobInput
  try {
    const checked = await withDraftLock(input.draftId, () => checkInput(input))
    const documents = await retrieveKnowledgeDocuments(input.userId, input.knowledgeBaseId, input.brief ?? input.title)
    if (!documents.length) throw new Error('知识库没有可使用的文档')
    const sources = documents.map(document => ({ ...document, source: document.source ?? 'knowledge_base', knowledgeBaseId: input.knowledgeBaseId, contentHash: createHash('sha256').update(document.content).digest('hex') }))
    await pool.query(`UPDATE jobs SET result=$2::jsonb,updated_at=NOW() WHERE job_id=$1`, [job.jobId, JSON.stringify({ progress: 20, stage: 'generating', sources })])
    const generated = await generateModelPage({
      kind: input.kind, title: input.title, slug: input.slug, locale: checked.locale, brief: input.brief ?? input.title,
      keywords: input.keywords, documents, existingPage: checked.source, operation: input.operation ?? 'generate', screenCap: checked.screenCap,
    })
    const active = await pool.query(`UPDATE jobs SET result=result || $2::jsonb,updated_at=NOW() WHERE job_id=$1 AND status='running' RETURNING job_id`, [job.jobId, JSON.stringify({ progress: 80, stage: 'saving', model: generated.model })])
    if (!active.rowCount) throw new Error('生成任务已经中断')
    const sourceReferences = sources.map(({ content: _content, ...reference }) => reference)
    if (input.reviewBeforeSave && input.operation === 'rewrite') {
      await withDraftLock(input.draftId, async () => {
        const current = await checkInput(input)
        await assertPageJobRunning(job.jobId)
        const proposal = createRewriteProposal(current.source!, generated.page, { jobId: job.jobId, model: generated.model, sources: sourceReferences })
        await pool.query(`UPDATE jobs SET status='completed',result=result || $2::jsonb,error=NULL,updated_at=NOW() WHERE job_id=$1 AND status='running'`, [job.jobId, JSON.stringify({ progress: 100, stage: 'review', proposal, expectedUpdatedAt: input.expectedUpdatedAt })])
      })
      return
    }
    const page = await withDraftLock(input.draftId, async () => {
      await checkInput(input)
      await assertPageJobRunning(job.jobId)
      return saveGeneratedDraftPageUnlocked(input.userId, input.draftId, {
        generated: generated.page, kind: input.kind, sourcePageId: input.pageId, expectedUpdatedAt: input.expectedUpdatedAt,
        targetPageId: input.targetPageId, targetExpectedUpdatedAt: input.targetExpectedUpdatedAt,
        operation: input.operation ?? 'generate', generation: { jobId: job.jobId, model: generated.model, sources: sourceReferences },
      })
    })
    await pool.query(`UPDATE jobs SET status='completed',result=result || $2::jsonb,error=NULL,updated_at=NOW() WHERE job_id=$1 AND status='running'`, [job.jobId, JSON.stringify({ progress: 100, stage: 'completed', pageId: page.pageId, page })])
  } catch (error) {
    await pool.query(`UPDATE jobs SET status='failed',error=$2,result=COALESCE(result,'{}'::jsonb) || '{"stage":"failed"}'::jsonb,updated_at=NOW() WHERE job_id=$1 AND status='running'`, [job.jobId, error instanceof Error ? error.message : String(error)])
  }
}

export async function runGeneratePageJob(input: PageJobInput): Promise<{ job: JobRecord; page?: PageRecord }> {
  const submitted = await submitPageJob(input)
  const claimed = await pool.query(`UPDATE jobs SET status='running',updated_at=NOW() WHERE job_id=$1 AND status='pending' RETURNING *`, [submitted.jobId])
  if (claimed.rowCount) await processClaimedPageJob(mapJob(claimed.rows[0]!))
  const job = await getJob(input.userId, submitted.jobId)
  if (!job) throw new Error('NOT_FOUND')
  return { job, page: job.result?.page as PageRecord | undefined }
}

export async function getJob(userId: string, jobId: string): Promise<JobRecord | null> {
  const result = await pool.query('SELECT * FROM jobs WHERE job_id=$1 AND user_id=$2', [jobId, userId])
  if (!result.rowCount) return null
  const job = mapJob(result.rows[0]!)
  if (Array.isArray(job.result?.sources)) {
    job.result.sources = (job.result.sources as Record<string, unknown>[]).map(({ content: _content, ...reference }) => reference)
  }
  return job
}
