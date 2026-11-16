import { afterAll, beforeEach, expect, it } from 'vitest'
import { pool } from './db.js'
import { resetTestDatabase } from './test-support/reset-test-db.js'
import { insertPublicInquiry } from './collaboration-public.js'
import { claimMailTask, recoverInterruptedMail, listInquiryMail, deliverMailTask, assertInquiryMailOwner } from './mail-service.js'
import { MAIL_SCHEMA_STATEMENTS } from './mail-schema.js'
import { resendInquiryEmail } from './collaboration-sites.js'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startMailWorker } from './mail-worker.js'

beforeEach(async () => {
  await resetTestDatabase()
  for (const statement of MAIL_SCHEMA_STATEMENTS) await pool.query(statement)
  await pool.query(`INSERT INTO sites(site_id,name,settings,created_at,updated_at) VALUES ('mail-site','邮件网站','{}',NOW(),NOW())`)
  await pool.query(`INSERT INTO site_drafts(draft_id,site_id,name,sandbox_id,status,created_at,updated_at) VALUES ('mail-draft','mail-site','邮件草稿','mail-sandbox','ready',NOW(),NOW())`)
})

afterAll(async () => { await pool.end() })

it('新询盘原子建立邮件任务，并发领取只返回一个任务', async () => {
  const { inquiryId } = await insertPublicInquiry('mail-site', { email: 'visitor@example.com' })
  const results = await Promise.all(Array.from({ length: 8 }, () => claimMailTask()))
  expect(results.filter(Boolean)).toHaveLength(1)
  const tasks = await listInquiryMail(inquiryId)
  expect(tasks).toHaveLength(1)
  expect(tasks[0]).toMatchObject({ status: 'claimed', attempts: 0 })
})

it('领取中断可以恢复，发送中断需要人工核实', async () => {
  const { inquiryId } = await insertPublicInquiry('mail-site', { name: '访客' })
  const first = await claimMailTask()
  await pool.query(`UPDATE inquiry_email_outbox SET lease_expires_at=NOW()-INTERVAL '1 second'`)
  await recoverInterruptedMail()
  const next = await claimMailTask()
  expect(next?.outboxId).toBe(first?.outboxId)
  expect(next?.claimToken).not.toBe(first?.claimToken)
  await pool.query(`UPDATE inquiry_email_outbox SET status='sending',lease_expires_at=NOW()-INTERVAL '1 second'`)
  await recoverInterruptedMail()
  expect(await claimMailTask()).toBeNull()
  expect((await listInquiryMail(inquiryId))[0]?.status).toBe('uncertain')
})

it('缺少 SMTP 配置保留错误，未授权用户无法访问邮件任务', async () => {
  const { inquiryId } = await insertPublicInquiry('mail-site', { name: '访客' })
  const task = await claimMailTask()
  const previous = process.env.SMTP_HOST
  delete process.env.SMTP_HOST
  try { await deliverMailTask(task!) } finally {
    if (previous !== undefined) process.env.SMTP_HOST = previous
  }
  expect((await listInquiryMail(inquiryId))[0]).toMatchObject({ status: 'failed', lastError: '缺少邮件配置 SMTP_HOST', attempts: 0 })
  expect(await claimMailTask()).toBeNull()
  await expect(assertInquiryMailOwner('unknown-user', inquiryId)).rejects.toThrow('FORBIDDEN')
})

it('人工重发复用等待中的任务，发送失败后可以建立新任务', async () => {
  await pool.query(`INSERT INTO users(user_id,account,password_hash,name,created_at,updated_at) VALUES ('mail-owner','mail-owner','unused','邮件用户',NOW(),NOW())`)
  await pool.query(`INSERT INTO site_owners(site_id,user_id,created_at) VALUES ('mail-site','mail-owner',NOW())`)
  const { inquiryId } = await insertPublicInquiry('mail-site', { name: '访客' })
  const results = await Promise.all(Array.from({ length: 6 }, () => resendInquiryEmail('mail-owner', inquiryId)))
  expect(new Set(results.map((result) => result.outboxId)).size).toBe(1)
  expect(await listInquiryMail(inquiryId)).toHaveLength(1)
  await pool.query(`UPDATE inquiry_email_outbox SET status='failed',last_error='缺少配置' WHERE inquiry_id=$1`, [inquiryId])
  const retry = await resendInquiryEmail('mail-owner', inquiryId)
  expect(retry.outboxId).not.toBe(results[0]!.outboxId)
  expect(await listInquiryMail(inquiryId)).toHaveLength(2)
  await expect(resendInquiryEmail('unknown-user', inquiryId)).rejects.toThrow('FORBIDDEN')
})

it('worker 遇到数据库结构错误立即使进程失败', async () => {
  await pool.query(`ALTER TABLE inquiry_email_outbox RENAME TO inquiry_email_outbox_unavailable`)
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./test-support/mail-worker-failure-child.ts', import.meta.url))], { env: process.env })
    let stderr = ''
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stderr }))
  })
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain('inquiry_email_outbox')
})

it('发送过程读取数据库失败时向上传递错误', async () => {
  const { inquiryId } = await insertPublicInquiry('mail-site', { name: '访客' })
  const task = await claimMailTask()
  await pool.query(`ALTER TABLE inquiries RENAME TO inquiries_unavailable`)
  const previous = Object.fromEntries(['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_TO', 'SMTP_USER'].map((key) => [key, process.env[key]]))
  Object.assign(process.env, { SMTP_HOST: 'localhost', SMTP_PORT: '465', SMTP_FROM: 'sender@example.com', SMTP_TO: 'recipient@example.com' })
  delete process.env.SMTP_USER
  try {
    await expect(deliverMailTask(task!)).rejects.toThrow('inquiries')
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  expect((await listInquiryMail(inquiryId))[0]?.status).toBe('claimed')
})

it('worker 保存配置错误后不会再次领取相同任务', async () => {
  const { inquiryId } = await insertPublicInquiry('mail-site', { name: '访客' })
  const previous = { SMTP_HOST: process.env.SMTP_HOST, SMTP_FROM: process.env.SMTP_FROM }
  process.env.SMTP_HOST = 'localhost'
  delete process.env.SMTP_FROM
  const worker = startMailWorker()
  try {
    await new Promise((resolve) => setTimeout(resolve, 1300))
    const first = (await listInquiryMail(inquiryId))[0]!
    expect(first).toMatchObject({ status: 'failed', attempts: 0, lastError: '缺少邮件配置 SMTP_FROM' })
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect((await listInquiryMail(inquiryId))[0]).toEqual(first)
  } finally {
    await worker.stop()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
