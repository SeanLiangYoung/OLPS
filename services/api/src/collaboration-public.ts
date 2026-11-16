import { pool } from './db.js'

async function resolveDraftIdForPublishedSite(siteId: string): Promise<string> {
  const row = await pool.query(
    `SELECT draft_id FROM site_drafts WHERE site_id=$1 ORDER BY updated_at DESC LIMIT 1`,
    [siteId],
  )
  if (!row.rowCount) {
    throw new Error(`站点 ${siteId} 无关联草稿`)
  }
  return String(row.rows[0]!.draft_id)
}

async function assertPublishedPageId(siteId: string, pageId: string | undefined): Promise<void> {
  if (!pageId) {
    return
  }
  const row = await pool.query(
    `SELECT 1 FROM site_published_pages WHERE site_id=$1 AND page_id=$2
     UNION
     SELECT 1 FROM pages WHERE site_id=$1 AND page_id=$2 AND status='published'`,
    [siteId, pageId],
  )
  if (!row.rowCount) {
    throw new Error('INVALID_PAGE_ID')
  }
}

export async function insertPublicInquiry(
  siteId: string,
  payload: Record<string, unknown>,
  pageId?: string,
): Promise<{ inquiryId: number }> {
  const site = await pool.query(`SELECT site_id FROM sites WHERE site_id=$1`, [siteId])
  if (!site.rowCount) {
    throw new Error(`站点不存在: ${siteId}`)
  }
  await assertPublishedPageId(siteId, pageId)
  const draftId = await resolveDraftIdForPublishedSite(siteId)
  const result = await pool.query(
    `WITH inquiry AS (
       INSERT INTO inquiries(draft_id, site_id, page_id, payload, status)
       VALUES ($1,$2,$3,$4::jsonb,'new') RETURNING inquiry_id
     ), notification AS (
       INSERT INTO inquiry_email_outbox(inquiry_id,site_id,payload)
       SELECT inquiry_id,$2,jsonb_build_object('reason','new') FROM inquiry
     ) SELECT inquiry_id FROM inquiry`,
    [draftId, siteId, pageId ?? null, JSON.stringify(payload)],
  )
  return { inquiryId: Number(result.rows[0]!.inquiry_id) }
}

export async function insertAnalyticsEvent(
  siteId: string,
  name: string,
  payload: Record<string, unknown>,
  pageId?: string,
): Promise<void> {
  const site = await pool.query(`SELECT site_id FROM sites WHERE site_id=$1`, [siteId])
  if (!site.rowCount) {
    throw new Error(`站点不存在: ${siteId}`)
  }
  if (pageId) {
    await assertPublishedPageId(siteId, pageId)
  }
  const draftId = await resolveDraftIdForPublishedSite(siteId)
  await pool.query(
    `INSERT INTO analytics_events(draft_id, site_id, page_id, name, payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [draftId, siteId, pageId ?? null, name, JSON.stringify(payload)],
  )
}
