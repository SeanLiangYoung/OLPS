import type { PageKind, PageRecord, PageStatus, SiteRecord } from '@olps/domain'
import { pool } from './db.js'
import { mapSiteRow } from './drafts-service.js'
import { isDraftOwner, isSiteOwner } from './permissions.js'

export async function listSitesForUser(userId: string): Promise<SiteRecord[]> {
  const result = await pool.query(
    `SELECT s.* FROM sites s
     INNER JOIN site_owners o ON o.site_id=s.site_id
     WHERE o.user_id=$1 ORDER BY s.updated_at DESC`,
    [userId],
  )
  return result.rows.map((row) => mapSiteRow(row))
}

export async function getSiteForUser(userId: string, siteId: string): Promise<SiteRecord | null> {
  if (!(await isSiteOwner(userId, siteId))) {
    return null
  }
  const result = await pool.query(`SELECT * FROM sites WHERE site_id=$1`, [siteId])
  if (!result.rowCount) return null
  return mapSiteRow(result.rows[0]!)
}

function mapPageRow(draftId: string, row: Record<string, unknown>): PageRecord {
  return {
    pageId: String(row.page_id),
    draftId,
    siteId: row.site_id ? String(row.site_id) : null,
    kind: row.kind as PageKind,
    slug: String(row.slug),
    title: String(row.title),
    status: row.status as PageStatus,
    locale: String(row.locale),
    seo: row.seo as PageRecord['seo'],
    body: row.body as PageRecord['body'],
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    publishedAt: row.published_at ? new Date(String(row.published_at)).toISOString() : null,
  }
}

export async function listPublishedSitePages(
  userId: string,
  siteId: string,
  filters: { status?: PageStatus } = {},
): Promise<PageRecord[]> {
  if (!(await isSiteOwner(userId, siteId))) {
    throw new Error('FORBIDDEN')
  }
  const site = await pool.query(
    `SELECT published_commit_id FROM sites WHERE site_id=$1`,
    [siteId],
  )
  if (!site.rowCount) {
    throw new Error('FORBIDDEN')
  }
  const commitId = site.rows[0]!.published_commit_id as string | null
  if (!commitId) {
    return []
  }
  const result = await pool.query(
    `SELECT * FROM site_published_pages
     WHERE site_id=$1 AND published_commit_id=$2
     ORDER BY slug ASC`,
    [siteId, commitId],
  )
  const draftRow = await pool.query(
    `SELECT draft_id FROM site_drafts WHERE site_id=$1 ORDER BY updated_at DESC LIMIT 1`,
    [siteId],
  )
  const draftId = draftRow.rowCount ? String(draftRow.rows[0]!.draft_id) : siteId
  return result.rows.map((row) =>
    mapPageRow(draftId, {
      ...row,
      status: 'published',
      created_at: new Date(),
      updated_at: new Date(),
      published_at: new Date(),
    }),
  )
}

export async function getSiteIntegrations(userId: string, siteId: string) {
  if (!(await isSiteOwner(userId, siteId))) {
    throw new Error('FORBIDDEN')
  }
  const result = await pool.query(`SELECT * FROM site_integrations WHERE site_id=$1`, [siteId])
  if (!result.rowCount) {
    const now = new Date().toISOString()
    const draft = await pool.query(
      `SELECT draft_id FROM site_drafts WHERE site_id=$1 ORDER BY updated_at DESC LIMIT 1`,
      [siteId],
    )
    if (!draft.rowCount) {
      throw new Error('FORBIDDEN')
    }
    await pool.query(
      `INSERT INTO site_integrations(draft_id, site_id, updated_at) VALUES ($1,$2,$3)`,
      [String(draft.rows[0]!.draft_id), siteId, now],
    )
    return {
      siteId,
      adsAccountId: '',
      adsConnected: false,
      gaPropertyId: '',
      gaConnected: false,
      updatedAt: now,
    }
  }
  const row = result.rows[0]!
  return {
    siteId,
    adsAccountId: String(row.ads_account_id),
    adsConnected: Boolean(row.ads_connected),
    gaPropertyId: String(row.ga_property_id),
    gaConnected: Boolean(row.ga_connected),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function patchSiteIntegrations(
  userId: string,
  siteId: string,
  patch: {
    adsAccountId?: string
    adsConnected?: boolean
    gaPropertyId?: string
    gaConnected?: boolean
  },
) {
  const current = await getSiteIntegrations(userId, siteId)
  const next = {
    adsAccountId: patch.adsAccountId ?? current.adsAccountId,
    adsConnected: patch.adsConnected ?? current.adsConnected,
    gaPropertyId: patch.gaPropertyId ?? current.gaPropertyId,
    gaConnected: patch.gaConnected ?? current.gaConnected,
    updatedAt: new Date().toISOString(),
  }
  if (next.adsConnected && !next.adsAccountId.trim()) {
    throw new Error('INTEGRATION_ADS_ACCOUNT_REQUIRED')
  }
  if (next.gaConnected && !next.gaPropertyId.trim()) {
    throw new Error('INTEGRATION_GA_PROPERTY_REQUIRED')
  }
  await pool.query(
    `UPDATE site_integrations SET
      ads_account_id=$2,
      ads_connected=$3,
      ga_property_id=$4,
      ga_connected=$5,
      updated_at=$6
     WHERE site_id=$1`,
    [
      siteId,
      next.adsAccountId,
      next.adsConnected,
      next.gaPropertyId,
      next.gaConnected,
      next.updatedAt,
    ],
  )
  return next
}

export async function listSiteInquiries(
  userId: string,
  siteId: string,
  filters: { status?: string } = {},
) {
  if (!(await isSiteOwner(userId, siteId))) {
    throw new Error('FORBIDDEN')
  }
  const clauses = ['site_id=$1']
  const values: unknown[] = [siteId]
  if (filters.status) {
    values.push(filters.status)
    clauses.push(`status=$${values.length}`)
  }
  const result = await pool.query(
    `SELECT inquiry_id, site_id, page_id, payload, status, created_at, updated_at
     FROM inquiries WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
    values,
  )
  return result.rows.map((row) => ({
    inquiryId: Number(row.inquiry_id),
    siteId: String(row.site_id),
    pageId: row.page_id ? String(row.page_id) : null,
    payload: row.payload as Record<string, unknown>,
    status: String(row.status ?? 'new'),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
  }))
}

export async function updateInquiryStatus(userId: string, inquiryId: number, status: string) {
  const allowed = new Set(['new', 'processing', 'done', 'spam'])
  if (!allowed.has(status)) {
    throw new Error(`非法询盘状态: ${status}`)
  }
  const row = await pool.query(
    `SELECT site_id, draft_id FROM inquiries WHERE inquiry_id=$1`,
    [inquiryId],
  )
  if (!row.rowCount) {
    throw new Error(`询盘不存在: ${inquiryId}`)
  }
  const siteId = row.rows[0]!.site_id as string | null
  const draftId = row.rows[0]!.draft_id as string | null
  if (siteId) {
    if (!(await isSiteOwner(userId, siteId))) {
      throw new Error('FORBIDDEN')
    }
  } else if (draftId) {
    if (!(await isDraftOwner(userId, draftId))) {
      throw new Error('FORBIDDEN')
    }
  } else {
    throw new Error('FORBIDDEN')
  }
  const now = new Date().toISOString()
  await pool.query(`UPDATE inquiries SET status=$1, updated_at=$2 WHERE inquiry_id=$3`, [
    status,
    now,
    inquiryId,
  ])
}

export async function resendInquiryEmail(userId: string, inquiryId: number) {
  const row = await pool.query(
    `SELECT inquiry_id, site_id, page_id, payload, status, created_at, updated_at
     FROM inquiries WHERE inquiry_id=$1`,
    [inquiryId],
  )
  if (!row.rowCount) {
    throw new Error(`询盘不存在: ${inquiryId}`)
  }
  const inq = row.rows[0]!
  const siteId = inq.site_id ? String(inq.site_id) : null
  const draftId = inq.draft_id ? String(inq.draft_id) : null
  if (siteId) {
    if (!(await isSiteOwner(userId, siteId))) {
      throw new Error('FORBIDDEN')
    }
  } else if (draftId) {
    if (!(await isDraftOwner(userId, draftId))) {
      throw new Error('FORBIDDEN')
    }
  } else {
    throw new Error('FORBIDDEN')
  }
  const inquiry = {
    inquiryId: Number(inq.inquiry_id),
    siteId: siteId ?? '',
    pageId: inq.page_id ? String(inq.page_id) : null,
    payload: inq.payload as Record<string, unknown>,
    status: String(inq.status ?? 'new'),
    createdAt: new Date(String(inq.created_at)).toISOString(),
    updatedAt: new Date(String(inq.updated_at ?? inq.created_at)).toISOString(),
  }
  const out = await pool.query(
    `INSERT INTO inquiry_email_outbox(inquiry_id, site_id, payload)
     VALUES ($1,$2,$3::jsonb) RETURNING outbox_id`,
    [inquiryId, siteId, JSON.stringify({ inquiry, reason: 'resend' })],
  )
  return { outboxId: Number(out.rows[0]!.outbox_id), inquiry }
}
