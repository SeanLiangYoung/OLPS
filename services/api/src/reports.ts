import { randomUUID } from 'node:crypto'
import type { PageRecord } from '@olps/domain'
import { pool } from './db.js'
import { getPage } from './store.js'

export type ReportChecklistItem = {
  id: string
  label: string
  passed: boolean
  detail: string
}

export type ReportRecord = {
  reportId: string
  tenantId: string
  siteId: string
  pageId: string
  score: number
  checklist: ReportChecklistItem[]
  createdAt: string
}

export async function runPageReport(tenantId: string, pageId: string): Promise<ReportRecord> {
  const page = await getPage(tenantId, pageId)
  if (!page) throw new Error(`页面不存在: ${pageId}`)
  const checklist = buildChecklist(page)
  const passed = checklist.filter((c) => c.passed).length
  const score = Math.round((passed / checklist.length) * 100)
  const now = new Date().toISOString()
  const reportId = randomUUID()
  await pool.query(
    `INSERT INTO reports(report_id, tenant_id, site_id, page_id, score, checklist, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [reportId, tenantId, page.siteId, page.pageId, score, JSON.stringify(checklist), now],
  )
  return {
    reportId,
    tenantId,
    siteId: page.siteId,
    pageId: page.pageId,
    score,
    checklist,
    createdAt: now,
  }
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
      passed: Boolean(ads && ads.screens.some((s) => s.role === 'cta') && ads.keywordCluster.length >= 2),
      detail: ads ? `${ads.screens.length} 屏 / ${ads.keywordCluster.length} 词` : '缺失 ads',
    })
    items.push({
      id: 'ads_inquiry',
      label: 'CTA 含询盘表单标记',
      passed: Boolean(ads?.screens.some((s) => s.role === 'cta' && s.html.includes('data-olps-inquiry'))),
      detail: 'data-olps-inquiry',
    })
  }
  return items
}

export async function listReports(tenantId: string, siteId: string): Promise<ReportRecord[]> {
  const result = await pool.query(
    `SELECT * FROM reports WHERE tenant_id=$1 AND site_id=$2 ORDER BY created_at DESC LIMIT 100`,
    [tenantId, siteId],
  )
  return result.rows.map(mapReport)
}

export async function getReport(tenantId: string, reportId: string): Promise<ReportRecord | null> {
  const result = await pool.query(`SELECT * FROM reports WHERE tenant_id=$1 AND report_id=$2`, [
    tenantId,
    reportId,
  ])
  if (!result.rowCount) return null
  return mapReport(result.rows[0]!)
}

function mapReport(row: Record<string, unknown>): ReportRecord {
  return {
    reportId: String(row.report_id),
    tenantId: String(row.tenant_id),
    siteId: String(row.site_id),
    pageId: String(row.page_id),
    score: Number(row.score),
    checklist: row.checklist as ReportChecklistItem[],
    createdAt: new Date(String(row.created_at)).toISOString(),
  }
}
