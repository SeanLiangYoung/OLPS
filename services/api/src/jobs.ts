import { randomUUID } from 'node:crypto'
import { pool } from './db.js'

export type JobRecord = {
  jobId: string
  tenantId: string
  siteId: string
  type: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  request: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  createdAt: string
  updatedAt: string
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    jobId: String(row.job_id),
    tenantId: String(row.tenant_id),
    siteId: String(row.site_id),
    type: String(row.type),
    status: row.status as JobRecord['status'],
    request: row.request as Record<string, unknown>,
    result: (row.result as Record<string, unknown> | null) ?? null,
    error: row.error ? String(row.error) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function createJob(input: {
  tenantId: string
  siteId: string
  type: string
  request: Record<string, unknown>
}): Promise<JobRecord> {
  const now = new Date().toISOString()
  const jobId = randomUUID()
  await pool.query(
    `INSERT INTO jobs(job_id, tenant_id, site_id, type, status, request, result, error, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'pending',$5::jsonb,NULL,NULL,$6,$7)`,
    [jobId, input.tenantId, input.siteId, input.type, JSON.stringify(input.request), now, now],
  )
  return {
    jobId,
    tenantId: input.tenantId,
    siteId: input.siteId,
    type: input.type,
    status: 'pending',
    request: input.request,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  }
}

export async function setJobStatus(
  tenantId: string,
  jobId: string,
  status: JobRecord['status'],
  patch: { result?: Record<string, unknown>; error?: string },
): Promise<JobRecord> {
  const now = new Date().toISOString()
  await pool.query(
    `UPDATE jobs SET status=$1, result=COALESCE($2::jsonb, result), error=$3, updated_at=$4
     WHERE tenant_id=$5 AND job_id=$6`,
    [
      status,
      patch.result ? JSON.stringify(patch.result) : null,
      patch.error ?? null,
      now,
      tenantId,
      jobId,
    ],
  )
  const job = await getJob(tenantId, jobId)
  if (!job) throw new Error(`Job 不存在: ${jobId}`)
  return job
}

export async function getJob(tenantId: string, jobId: string): Promise<JobRecord | null> {
  const result = await pool.query(`SELECT * FROM jobs WHERE tenant_id=$1 AND job_id=$2`, [
    tenantId,
    jobId,
  ])
  if (!result.rowCount) return null
  return mapJob(result.rows[0]!)
}

export async function listRecentJobs(tenantId: string, siteId: string, limit = 20): Promise<JobRecord[]> {
  const result = await pool.query(
    `SELECT * FROM jobs WHERE tenant_id=$1 AND site_id=$2 ORDER BY created_at DESC LIMIT $3`,
    [tenantId, siteId, limit],
  )
  return result.rows.map(mapJob)
}
