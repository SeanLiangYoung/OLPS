import type { PageKind } from '@olps/domain'
import { pool } from './db.js'
import { isDraftOwner } from './permissions.js'
import { getJob } from './collaboration-jobs.js'

export async function buildDraftDashboard(userId: string, draftId: string) {
  if (!(await isDraftOwner(userId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const pages = await pool.query(
    `SELECT kind, status FROM pages WHERE draft_id=$1`,
    [draftId],
  )
  const pagesByKind: Record<PageKind, number> = { site: 0, content: 0 }
  for (const row of pages.rows) {
    const kind = String(row.kind) as PageKind
    pagesByKind[kind] = (pagesByKind[kind] ?? 0) + 1
  }
  const draft = await pool.query(`SELECT site_id FROM site_drafts WHERE draft_id=$1`, [draftId])
  const siteId = draft.rows[0]?.site_id ? String(draft.rows[0]!.site_id) : null
  let publishedCount = 0
  let inquiryCount = 0
  let sitemapUrl: string | null = null
  if (siteId) {
    const pub = await pool.query(
      `SELECT COUNT(*)::int AS c FROM pages WHERE site_id=$1 AND status='published'`,
      [siteId],
    )
    publishedCount = Number(pub.rows[0]!.c)
    const inq = await pool.query(
      `SELECT COUNT(*)::int AS c FROM inquiries WHERE site_id=$1`,
      [siteId],
    )
    inquiryCount = Number(inq.rows[0]!.c)
    const site = await pool.query(`SELECT public_url FROM sites WHERE site_id=$1`, [siteId])
    const publicUrl = site.rows[0]?.public_url ? String(site.rows[0]!.public_url) : ''
    if (publicUrl) {
      sitemapUrl = `${publicUrl.replace(/\/+$/, '')}/sitemap.xml`
    }
  }
  const jobs = await pool.query(
    `SELECT job_id FROM jobs WHERE draft_id=$1 ORDER BY created_at DESC LIMIT 5`,
    [draftId],
  )
  const recentJobs = []
  for (const row of jobs.rows) {
    const job = await getJob(userId, String(row.job_id))
    if (job) recentJobs.push(job)
  }
  return {
    draftId,
    siteId,
    pagesByKind,
    publishedCount,
    inquiryCount,
    sitemapUrl,
    recentJobs,
  }
}

export async function buildUserDashboard(userId: string) {
  const pages = await pool.query(
    `SELECT p.kind FROM pages p
     INNER JOIN draft_owners o ON o.draft_id=p.draft_id
     WHERE o.user_id=$1`,
    [userId],
  )
  const pagesByKind: Record<PageKind, number> = { site: 0, content: 0 }
  for (const row of pages.rows) {
    const kind = String(row.kind) as PageKind
    pagesByKind[kind] = (pagesByKind[kind] ?? 0) + 1
  }
  const sites = await pool.query(
    `SELECT COUNT(*)::int AS c FROM site_owners WHERE user_id=$1`,
    [userId],
  )
  return {
    pagesByKind,
    publishedCount: Number(sites.rows[0]!.c),
  }
}
