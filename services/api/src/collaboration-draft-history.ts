import { pool } from './db.js'
import { isDraftOwner } from './permissions.js'

export async function listDraftInquiries(
  userId: string,
  draftId: string,
  filters: { status?: string } = {},
) {
  if (!(await isDraftOwner(userId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const clauses = ['draft_id=$1']
  const values: unknown[] = [draftId]
  if (filters.status) {
    values.push(filters.status)
    clauses.push(`status=$${values.length}`)
  }
  const result = await pool.query(
    `SELECT inquiry_id, draft_id, site_id, page_id, payload, status, created_at, updated_at
     FROM inquiries WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
    values,
  )
  return result.rows.map((row) => ({
    inquiryId: Number(row.inquiry_id),
    draftId: row.draft_id ? String(row.draft_id) : null,
    siteId: row.site_id ? String(row.site_id) : null,
    pageId: row.page_id ? String(row.page_id) : null,
    payload: row.payload as Record<string, unknown>,
    status: String(row.status ?? 'new'),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
  }))
}
