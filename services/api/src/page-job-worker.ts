import { pool } from './db.js'
import { mapJob, processClaimedPageJob } from './collaboration-jobs.js'

export async function recoverExpiredPageJobs(): Promise<number> {
  const result = await pool.query(`UPDATE jobs SET status='failed',error='生成任务执行中断，已超过十分钟有效时间，请检查页面和任务记录后重新提交',
    result=COALESCE(result,'{}'::jsonb) || '{"stage":"interrupted"}'::jsonb,updated_at=NOW()
    WHERE type='generate_page' AND status='running' AND updated_at < NOW()-INTERVAL '10 minutes'`)
  return result.rowCount ?? 0
}

export async function processNextPageJob(): Promise<boolean> {
  await recoverExpiredPageJobs()
  const result = await pool.query(`UPDATE jobs SET status='running',updated_at=NOW(),result=COALESCE(result,'{}'::jsonb) || '{"progress":5,"stage":"checking"}'::jsonb
    WHERE job_id=(SELECT job_id FROM jobs WHERE type='generate_page' AND status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`)
  if (!result.rowCount) return false
  await processClaimedPageJob(mapJob(result.rows[0]!))
  return true
}

export function startPageJobWorker(intervalMs = 1000): () => Promise<void> {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let current: Promise<void> = Promise.resolve()
  const run = async () => {
    while (!stopped && await processNextPageJob()) { /* 继续处理已保存任务。 */ }
    if (!stopped) {
      timer = setTimeout(() => { current = run() }, intervalMs)
      timer.unref()
    }
  }
  current = run()
  return async () => {
    stopped = true
    if (timer) clearTimeout(timer)
    await current
  }
}
