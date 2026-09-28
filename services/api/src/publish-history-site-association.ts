import type pg from 'pg'

export async function associateDraftHistoryWithSite(
  client: pg.PoolClient,
  draftId: string,
  siteId: string,
): Promise<void> {
  await client.query(`UPDATE inquiries SET site_id = $2 WHERE draft_id = $1`, [draftId, siteId])
  await client.query(`UPDATE reports SET site_id = $2 WHERE draft_id = $1`, [draftId, siteId])
  await client.query(`UPDATE jobs SET site_id = $2 WHERE draft_id = $1`, [draftId, siteId])
  await client.query(`UPDATE analytics_events SET site_id = $2 WHERE draft_id = $1`, [
    draftId,
    siteId,
  ])
  await client.query(
    `UPDATE inquiry_email_outbox o SET site_id = $2
     FROM inquiries i
     WHERE o.inquiry_id = i.inquiry_id AND i.draft_id = $1`,
    [draftId, siteId],
  )
  await client.query(
    `UPDATE site_integrations SET site_id = $2 WHERE draft_id = $1 AND site_id IS NULL`,
    [draftId, siteId],
  )
}
