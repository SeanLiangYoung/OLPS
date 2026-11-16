import { defaultSiteSettings } from '@olps/domain'
import { pool } from './db.js'
import { isDraftOwner, isSiteOwner } from './permissions.js'

export type ReportSiteData = {
  status: 'available' | 'unpublished'
  draftId: string
  siteId: string | null
  pageId: string
  pageTitle: string
  siteName: string | null
  capturedAt: string
  period: { start: string; end: string }
  analyticsEnabled: boolean | null
  eventCount: number | null
  inquiryCount: number | null
  events: Array<{ name: string; count: number }>
  eventsTruncated: boolean
}

function safeCount(value: unknown): number {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('网站统计数量超出有效范围')
  return count
}

export async function getReportSiteData(userId: string, draftId: string, pageId: string): Promise<ReportSiteData> {
  if (!(await isDraftOwner(userId, draftId))) throw new Error('FORBIDDEN')
  const target = await pool.query(`SELECT d.site_id,s.settings,s.name AS site_name,p.title AS page_title FROM site_drafts d
    JOIN pages p ON p.draft_id=d.draft_id AND p.page_id=$2
    LEFT JOIN sites s ON s.site_id=d.site_id WHERE d.draft_id=$1`, [draftId, pageId])
  if (!target.rowCount) throw new Error('NOT_FOUND')
  const siteId = target.rows[0].site_id ? String(target.rows[0].site_id) : null
  if (siteId && !(await isSiteOwner(userId, siteId))) throw new Error('FORBIDDEN')
  const end = new Date()
  const period = { start: new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString(), end: end.toISOString() }
  const common = { draftId, siteId, pageId, pageTitle: String(target.rows[0].page_title), siteName: siteId ? String(target.rows[0].site_name) : null, period, capturedAt: end.toISOString() }
  if (!siteId) return { ...common, status: 'unpublished', analyticsEnabled: null, eventCount: null, inquiryCount: null, events: [], eventsTruncated: false }
  const result = await pool.query(`WITH event_counts AS (
      SELECT name,COUNT(*) AS amount FROM analytics_events
      WHERE site_id=$1 AND page_id=$2 AND created_at >= $3 AND created_at < $4 GROUP BY name
    ), top_events AS (SELECT name,amount FROM event_counts ORDER BY amount DESC,name LIMIT 100)
    SELECT (SELECT COALESCE(SUM(amount),0)::text FROM event_counts) AS event_count,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('name',name,'count',amount) ORDER BY amount DESC,name),'[]'::jsonb) FROM top_events) AS events,
      (SELECT COUNT(*) > 100 FROM event_counts) AS events_truncated,
      (SELECT COUNT(*)::text FROM inquiries WHERE site_id=$1 AND page_id=$2 AND created_at >= $3 AND created_at < $4) AS inquiry_count`,
    [siteId, pageId, period.start, period.end])
  const row = result.rows[0]
  const settings = { ...defaultSiteSettings(), ...target.rows[0].settings }
  return { ...common, status: 'available', analyticsEnabled: settings.analyticsEnabled,
    eventCount: safeCount(row.event_count), inquiryCount: safeCount(row.inquiry_count),
    events: row.events as ReportSiteData['events'], eventsTruncated: Boolean(row.events_truncated) }
}
