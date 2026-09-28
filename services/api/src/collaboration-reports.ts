import { randomUUID } from 'node:crypto'
import type { PageRecord } from '@olps/domain'
import { pool } from './db.js'
import { getDraftPageForUser } from './drafts-service.js'
import { isDraftOwner, isSiteOwner } from './permissions.js'

export type ReportChecklistItem = {
  id: string
  label: string
  passed: boolean
  detail: string
}

export type ReportRecord = {
  reportId: string
  userId: string
  siteId: string | null
  draftId: string
  pageId: string
  score: number
  checklist: ReportChecklistItem[]
  createdAt: string
}

function buildChecklist(page: PageRecord): ReportChecklistItem[] {
  const html = page.body.html ?? ''
  const items: ReportChecklistItem[] = [
    {
      id: 'seo_title',
      label: 'SEO title 非空',
      passed: Boolean(page.seo.title?.trim()),
      detail: page.seo.title || '(空)',
    },
    {
      id: 'seo_description',
      label: 'SEO description 非空',
      passed: Boolean(page.seo.description?.trim()),
      detail: page.seo.description || '(空)',
    },
    {
      id: 'has_h1',
      label: '正文含 H1',
      passed: /<h1[\s>]/i.test(html) || Boolean(page.body.ads),
      detail: page.body.ads ? '广告页由分屏承载标题' : /<h1[\s>]/i.test(html) ? '已检测到' : '未检测到',
    },
    {
      id: 'viewport',
      label: '含 viewport meta（或由壳层提供）',
      passed: /viewport/i.test(html) || Boolean(page.body.ads),
      detail: '响应式基础',
    },
    {
      id: 'locale',
      label: 'locale 已设置',
      passed: Boolean(page.locale),
      detail: page.locale,
    },
  ]
  if (page.kind === 'ads') {
    const ads = page.body.ads
    items.push({
      id: 'ads_screens',
      label: '广告页含共用屏与 CTA',
      passed: Boolean(
        ads && ads.screens.some((s) => s.role === 'cta') && ads.keywordCluster.length >= 2,
      ),
      detail: ads ? `${ads.screens.length} 屏 / ${ads.keywordCluster.length} 词` : '缺失 ads',
    })
    items.push({
      id: 'ads_inquiry',
      label: 'CTA 含询盘表单标记',
      passed: Boolean(
        ads?.screens.some((s) => s.role === 'cta' && s.html.includes('data-olps-inquiry')),
      ),
      detail: 'data-olps-inquiry',
    })
  }
  return items
}

function mapReportRow(row: Record<string, unknown>): ReportRecord {
  return {
    reportId: String(row.report_id),
    userId: String(row.user_id),
    siteId: row.site_id ? String(row.site_id) : null,
    draftId: String(row.draft_id),
    pageId: String(row.page_id),
    score: Number(row.score),
    checklist: row.checklist as ReportChecklistItem[],
    createdAt: new Date(String(row.created_at)).toISOString(),
  }
}

async function resolveReportAccess(
  userId: string,
  row: Record<string, unknown>,
): Promise<boolean> {
  const draftId = row.draft_id ? String(row.draft_id) : null
  const storedSiteId = row.site_id ? String(row.site_id) : null
  if (storedSiteId) {
    return isSiteOwner(userId, storedSiteId)
  }
  if (draftId) {
    return isDraftOwner(userId, draftId)
  }
  return false
}

export async function createReport(input: {
  userId: string
  draftId: string
  pageId: string
  siteId?: string | null
}): Promise<ReportRecord> {
  if (!(await isDraftOwner(input.userId, input.draftId))) {
    throw new Error('FORBIDDEN')
  }
  const draftRow = await pool.query(`SELECT site_id FROM site_drafts WHERE draft_id=$1`, [
    input.draftId,
  ])
  if (!draftRow.rowCount) {
    throw new Error(`草稿不存在: ${input.draftId}`)
  }
  const linkedSiteId = draftRow.rows[0]!.site_id as string | null
  let storeSiteId: string | null = null

  if (linkedSiteId) {
    if (!(await isSiteOwner(input.userId, linkedSiteId))) {
      throw new Error('FORBIDDEN')
    }
    const requestedSiteId =
      input.siteId !== undefined && input.siteId !== null ? String(input.siteId).trim() : ''
    if (requestedSiteId && requestedSiteId !== linkedSiteId) {
      throw new Error('FORBIDDEN')
    }
    storeSiteId = linkedSiteId
  } else {
    const requestedSiteId =
      input.siteId !== undefined && input.siteId !== null ? String(input.siteId).trim() : ''
    if (requestedSiteId) {
      throw new Error('FORBIDDEN')
    }
    storeSiteId = null
  }

  const page = await getDraftPageForUser(input.userId, input.draftId, input.pageId)
  if (!page) {
    throw new Error(`页面不存在: ${input.draftId}/${input.pageId}`)
  }
  const checklist = buildChecklist(page)
  const passed = checklist.filter((c) => c.passed).length
  const score = Math.round((passed / checklist.length) * 100)
  const now = new Date().toISOString()
  const reportId = randomUUID()
  await pool.query(
    `INSERT INTO reports(report_id, user_id, site_id, draft_id, page_id, score, checklist, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      reportId,
      input.userId,
      storeSiteId,
      input.draftId,
      input.pageId,
      score,
      JSON.stringify(checklist),
      now,
    ],
  )
  return {
    reportId,
    userId: input.userId,
    siteId: storeSiteId,
    draftId: input.draftId,
    pageId: input.pageId,
    score,
    checklist,
    createdAt: now,
  }
}

export async function listDraftReports(userId: string, draftId: string): Promise<ReportRecord[]> {
  if (!(await isDraftOwner(userId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const result = await pool.query(
    `SELECT * FROM reports WHERE draft_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [draftId],
  )
  return result.rows.map((row) => mapReportRow(row))
}

export async function listSiteReports(userId: string, siteId: string): Promise<ReportRecord[]> {
  if (!(await isSiteOwner(userId, siteId))) {
    throw new Error('FORBIDDEN')
  }
  const result = await pool.query(
    `SELECT * FROM reports WHERE site_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [siteId],
  )
  return result.rows.map((row) => mapReportRow(row))
}

export async function getDraftReport(
  userId: string,
  draftId: string,
  reportId: string,
): Promise<ReportRecord | null> {
  const result = await pool.query(
    `SELECT * FROM reports WHERE report_id=$1 AND draft_id=$2`,
    [reportId, draftId],
  )
  if (!result.rowCount) {
    return null
  }
  const row = result.rows[0]!
  if (!(await resolveReportAccess(userId, row))) {
    throw new Error('FORBIDDEN')
  }
  return mapReportRow(row)
}

export async function getReport(userId: string, reportId: string): Promise<ReportRecord | null> {
  const result = await pool.query(`SELECT * FROM reports WHERE report_id=$1`, [reportId])
  if (!result.rowCount) return null
  const row = result.rows[0]!
  if (!(await resolveReportAccess(userId, row))) {
    throw new Error('FORBIDDEN')
  }
  return mapReportRow(row)
}
