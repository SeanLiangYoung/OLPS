import { randomUUID } from 'node:crypto'
import {
  defaultSiteSettings,
  type PageBody,
  type PageKind,
  type PageRecord,
  type PageStatus,
  type SeoFields,
  type SiteRecord,
  type SiteSettings,
} from '@olps/domain'
import { pool } from './db.js'
import { appConfig } from './config.js'

function mapSite(row: Record<string, unknown>): SiteRecord {
  return {
    siteId: String(row.site_id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    settings: row.settings as SiteSettings,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

function mapPage(row: Record<string, unknown>): PageRecord {
  return {
    pageId: String(row.page_id),
    siteId: String(row.site_id),
    tenantId: String(row.tenant_id),
    kind: row.kind as PageKind,
    slug: String(row.slug),
    title: String(row.title),
    status: row.status as PageStatus,
    locale: String(row.locale),
    seo: row.seo as SeoFields,
    body: row.body as PageBody,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    publishedAt: row.published_at ? new Date(String(row.published_at)).toISOString() : null,
  }
}

export async function createSite(tenantId: string, name: string): Promise<SiteRecord> {
  const now = new Date().toISOString()
  const siteId = randomUUID()
  const settings = defaultSiteSettings(appConfig.defaultScreenCap)
  await pool.query(
    `INSERT INTO sites(site_id, tenant_id, name, settings, created_at, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
    [siteId, tenantId, name, JSON.stringify(settings), now, now],
  )
  return {
    siteId,
    tenantId,
    name,
    settings,
    createdAt: now,
    updatedAt: now,
  }
}

export async function listSites(tenantId: string): Promise<SiteRecord[]> {
  const result = await pool.query(`SELECT * FROM sites WHERE tenant_id=$1 ORDER BY created_at`, [
    tenantId,
  ])
  return result.rows.map(mapSite)
}

export async function getSite(tenantId: string, siteId: string): Promise<SiteRecord | null> {
  const result = await pool.query(`SELECT * FROM sites WHERE tenant_id=$1 AND site_id=$2`, [
    tenantId,
    siteId,
  ])
  if (result.rowCount === 0) return null
  return mapSite(result.rows[0]!)
}

export async function updateSiteSettings(
  tenantId: string,
  siteId: string,
  patch: Partial<SiteSettings>,
): Promise<SiteRecord> {
  const site = await getSite(tenantId, siteId)
  if (!site) throw new Error(`站点不存在: ${siteId}`)
  const settings = { ...site.settings, ...patch }
  const now = new Date().toISOString()
  await pool.query(
    `UPDATE sites SET settings=$1::jsonb, updated_at=$2 WHERE tenant_id=$3 AND site_id=$4`,
    [JSON.stringify(settings), now, tenantId, siteId],
  )
  return { ...site, settings, updatedAt: now }
}

export async function insertPage(input: {
  tenantId: string
  siteId: string
  kind: PageKind
  slug: string
  title: string
  locale: string
  seo: SeoFields
  body: PageBody
}): Promise<PageRecord> {
  const now = new Date().toISOString()
  const pageId = randomUUID()
  await pool.query(
    `INSERT INTO pages(
      page_id, site_id, tenant_id, kind, slug, title, status, locale, seo, body, created_at, updated_at, published_at
    ) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8::jsonb,$9::jsonb,$10,$11,NULL)`,
    [
      pageId,
      input.siteId,
      input.tenantId,
      input.kind,
      input.slug,
      input.title,
      input.locale,
      JSON.stringify(input.seo),
      JSON.stringify(input.body),
      now,
      now,
    ],
  )
  return {
    pageId,
    siteId: input.siteId,
    tenantId: input.tenantId,
    kind: input.kind,
    slug: input.slug,
    title: input.title,
    status: 'draft',
    locale: input.locale,
    seo: input.seo,
    body: input.body,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  }
}

export async function listPages(
  tenantId: string,
  siteId: string,
  filters: { kind?: PageKind; status?: PageStatus },
): Promise<PageRecord[]> {
  const clauses = ['tenant_id=$1', 'site_id=$2']
  const values: unknown[] = [tenantId, siteId]
  if (filters.kind) {
    values.push(filters.kind)
    clauses.push(`kind=$${values.length}`)
  }
  if (filters.status) {
    values.push(filters.status)
    clauses.push(`status=$${values.length}`)
  }
  const result = await pool.query(
    `SELECT * FROM pages WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`,
    values,
  )
  return result.rows.map(mapPage)
}

export async function getPage(tenantId: string, pageId: string): Promise<PageRecord | null> {
  const result = await pool.query(`SELECT * FROM pages WHERE tenant_id=$1 AND page_id=$2`, [
    tenantId,
    pageId,
  ])
  if (result.rowCount === 0) return null
  return mapPage(result.rows[0]!)
}

export async function updatePage(
  tenantId: string,
  pageId: string,
  patch: {
    title?: string
    slug?: string
    seo?: SeoFields
    body?: PageBody
    status?: PageStatus
    publishedAt?: string | null
  },
): Promise<PageRecord> {
  const page = await getPage(tenantId, pageId)
  if (!page) throw new Error(`页面不存在: ${pageId}`)
  const next: PageRecord = {
    ...page,
    title: patch.title ?? page.title,
    slug: patch.slug ?? page.slug,
    seo: patch.seo ?? page.seo,
    body: patch.body ?? page.body,
    status: patch.status ?? page.status,
    publishedAt:
      patch.publishedAt !== undefined ? patch.publishedAt : page.publishedAt,
    updatedAt: new Date().toISOString(),
  }
  await pool.query(
    `UPDATE pages SET title=$1, slug=$2, seo=$3::jsonb, body=$4::jsonb, status=$5,
      published_at=$6, updated_at=$7 WHERE tenant_id=$8 AND page_id=$9`,
    [
      next.title,
      next.slug,
      JSON.stringify(next.seo),
      JSON.stringify(next.body),
      next.status,
      next.publishedAt,
      next.updatedAt,
      tenantId,
      pageId,
    ],
  )
  return next
}

export async function insertInquiry(input: {
  tenantId: string
  siteId: string
  pageId?: string
  payload: Record<string, unknown>
}): Promise<{ inquiryId: number }> {
  const result = await pool.query(
    `INSERT INTO inquiries(tenant_id, site_id, page_id, payload, status)
     VALUES ($1,$2,$3,$4::jsonb,'new') RETURNING inquiry_id`,
    [input.tenantId, input.siteId, input.pageId ?? null, JSON.stringify(input.payload)],
  )
  return { inquiryId: Number(result.rows[0]!.inquiry_id) }
}

export async function listInquiries(
  tenantId: string,
  siteId: string,
  filters: { status?: string } = {},
) {
  const clauses = ['tenant_id=$1', 'site_id=$2']
  const values: unknown[] = [tenantId, siteId]
  if (filters.status) {
    values.push(filters.status)
    clauses.push(`status=$${values.length}`)
  }
  const result = await pool.query(
    `SELECT inquiry_id, tenant_id, site_id, page_id, payload, status, created_at, updated_at
     FROM inquiries WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
    values,
  )
  return result.rows.map((row) => ({
    inquiryId: Number(row.inquiry_id),
    tenantId: String(row.tenant_id),
    siteId: String(row.site_id),
    pageId: row.page_id ? String(row.page_id) : null,
    payload: row.payload as Record<string, unknown>,
    status: String(row.status ?? 'new'),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
  }))
}

export async function getInquiry(tenantId: string, inquiryId: number) {
  const result = await pool.query(
    `SELECT inquiry_id, tenant_id, site_id, page_id, payload, status, created_at, updated_at
     FROM inquiries WHERE tenant_id=$1 AND inquiry_id=$2`,
    [tenantId, inquiryId],
  )
  if (!result.rowCount) return null
  const row = result.rows[0]!
  return {
    inquiryId: Number(row.inquiry_id),
    tenantId: String(row.tenant_id),
    siteId: String(row.site_id),
    pageId: row.page_id ? String(row.page_id) : null,
    payload: row.payload as Record<string, unknown>,
    status: String(row.status ?? 'new'),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
  }
}

export async function updateInquiryStatus(
  tenantId: string,
  inquiryId: number,
  status: string,
) {
  const allowed = new Set(['new', 'processing', 'done', 'spam'])
  if (!allowed.has(status)) throw new Error(`非法询盘状态: ${status}`)
  const now = new Date().toISOString()
  const result = await pool.query(
    `UPDATE inquiries SET status=$1, updated_at=$2
     WHERE tenant_id=$3 AND inquiry_id=$4
     RETURNING inquiry_id`,
    [status, now, tenantId, inquiryId],
  )
  if (!result.rowCount) throw new Error(`询盘不存在: ${inquiryId}`)
  return getInquiry(tenantId, inquiryId)
}

export async function resendInquiryEmail(tenantId: string, inquiryId: number) {
  const inquiry = await getInquiry(tenantId, inquiryId)
  if (!inquiry) throw new Error(`询盘不存在: ${inquiryId}`)
  const result = await pool.query(
    `INSERT INTO inquiry_email_outbox(inquiry_id, tenant_id, payload)
     VALUES ($1,$2,$3::jsonb) RETURNING outbox_id`,
    [inquiryId, tenantId, JSON.stringify({ inquiry, reason: 'resend' })],
  )
  return { outboxId: Number(result.rows[0]!.outbox_id), inquiry }
}

export async function countInquiries(tenantId: string, siteId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS c FROM inquiries WHERE tenant_id=$1 AND site_id=$2`,
    [tenantId, siteId],
  )
  return Number(result.rows[0]!.c)
}

export async function insertAnalyticsEvent(input: {
  tenantId: string
  siteId: string
  pageId?: string
  name: string
  payload: Record<string, unknown>
}) {
  await pool.query(
    `INSERT INTO analytics_events(tenant_id, site_id, page_id, name, payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [
      input.tenantId,
      input.siteId,
      input.pageId ?? null,
      input.name,
      JSON.stringify(input.payload),
    ],
  )
}
