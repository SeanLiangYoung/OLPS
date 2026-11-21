import { pool } from './db.js'
import { initializeCmsSite } from './cms-sites.js'

export async function resumeCmsInitializations(): Promise<void> {
  const pending = await pool.query(`SELECT d.site_id,MIN(o.user_id) AS user_id FROM site_drafts d
    JOIN site_owners o USING(site_id) WHERE d.init_status='initializing' GROUP BY d.site_id ORDER BY d.site_id`)
  for (const row of pending.rows) await initializeCmsSite(row.user_id, row.site_id)
}
