import { pool } from './db.js'
import { isDraftOwner, isSiteOwner } from './permissions.js'

const inquiryScope = `((draft_id=$1 AND site_id IS NULL) OR
  (site_id=(SELECT site_id FROM site_drafts WHERE draft_id=$1) AND EXISTS (
    SELECT 1 FROM site_owners so WHERE so.site_id=inquiries.site_id AND so.user_id=$2)) OR
  (site_id IS NULL AND EXISTS (SELECT 1 FROM site_drafts d JOIN draft_owners o ON o.draft_id=d.draft_id
    WHERE d.draft_id=inquiries.draft_id AND o.user_id=$2 AND d.site_id IS NOT NULL
    AND d.site_id=(SELECT site_id FROM site_drafts WHERE draft_id=$1))))`

export async function countDraftInquiries(userId: string, draftId: string): Promise<number> {
  if (!(await isDraftOwner(userId, draftId))) throw new Error('FORBIDDEN')
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM inquiries WHERE ${inquiryScope}`, [draftId, userId])
  return Number(result.rows[0].count)
}

export async function listDraftInquiries(
  userId: string,
  draftId: string,
  filters: { status?: string } = {},
) {
  if (!(await isDraftOwner(userId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const clauses = [inquiryScope]
  const values: unknown[] = [draftId, userId]
  if (filters.status) {
    values.push(filters.status)
    clauses.push(`status=$${values.length}`)
  }
  const result = await pool.query(
    `SELECT inquiry_id, draft_id, site_id, page_id, payload, status, created_at, updated_at
     FROM inquiries WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
    values,
  )
  const inquiries: Array<{
    inquiryId: number
    draftId: string | null
    siteId: string | null
    pageId: string | null
    payload: Record<string, unknown>
    status: string
    createdAt: string
    updatedAt: string
  }> = []
  for (const row of result.rows) {
    const siteId = row.site_id ? String(row.site_id) : null
    if (siteId && !(await isSiteOwner(userId, siteId))) {
      continue
    }
    inquiries.push({
      inquiryId: Number(row.inquiry_id),
      draftId: row.draft_id ? String(row.draft_id) : null,
      siteId,
      pageId: row.page_id ? String(row.page_id) : null,
      payload: row.payload as Record<string, unknown>,
      status: String(row.status ?? 'new'),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
    })
  }
  return inquiries
}
