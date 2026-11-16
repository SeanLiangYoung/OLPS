import { randomUUID } from 'node:crypto'
import nodemailer from 'nodemailer'
import { pool } from './db.js'
import { isDraftOwner, isSiteOwner } from './permissions.js'

export interface MailTask {
  outboxId: number
  inquiryId: number
  status: string
  attempts: number
  lastError: string | null
  sentAt: string | null
  claimToken: string | null
  createdAt: string
}

function mapTask(row: Record<string, unknown>): MailTask {
  return {
    outboxId: Number(row.outbox_id), inquiryId: Number(row.inquiry_id),
    status: String(row.status), attempts: Number(row.attempts),
    lastError: row.last_error ? String(row.last_error) : null,
    sentAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : null,
    claimToken: row.claim_token ? String(row.claim_token) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  }
}

export async function listInquiryMail(inquiryId: number): Promise<MailTask[]> {
  const result = await pool.query(`SELECT * FROM inquiry_email_outbox WHERE inquiry_id=$1 ORDER BY outbox_id DESC`, [inquiryId])
  return result.rows.map(mapTask)
}

export async function assertInquiryMailOwner(userId: string, inquiryId: number): Promise<void> {
  const result = await pool.query(`SELECT site_id,draft_id FROM inquiries WHERE inquiry_id=$1`, [inquiryId])
  const row = result.rows[0]
  if (!row || !(row.site_id ? await isSiteOwner(userId, String(row.site_id)) : row.draft_id && await isDraftOwner(userId, String(row.draft_id)))) {
    throw new Error('FORBIDDEN')
  }
}

export async function claimMailTask(): Promise<MailTask | null> {
  const result = await pool.query(
    `WITH candidate AS (SELECT outbox_id FROM inquiry_email_outbox WHERE status='pending'
      ORDER BY outbox_id FOR UPDATE SKIP LOCKED LIMIT 1)
     UPDATE inquiry_email_outbox o SET status='claimed',claim_token=$1,
       lease_expires_at=NOW()+INTERVAL '5 minutes'
     FROM candidate WHERE o.outbox_id=candidate.outbox_id RETURNING o.*`, [randomUUID()],
  )
  return result.rowCount ? mapTask(result.rows[0]!) : null
}

export async function recoverInterruptedMail(): Promise<void> {
  await pool.query(`UPDATE inquiry_email_outbox SET status='pending',claim_token=NULL,lease_expires_at=NULL
    WHERE status='claimed' AND lease_expires_at<NOW()`)
  await pool.query(`UPDATE inquiry_email_outbox SET status='uncertain',last_error='发送过程被中断，请核实收件箱后决定是否重发',lease_expires_at=NULL
    WHERE status='sending' AND lease_expires_at<NOW()`)
}

class MailConfigurationError extends Error {}
class MailDeliveryError extends Error {}

function isSmtpError(error: unknown): boolean {
  if (error instanceof MailDeliveryError) return true
  if (!(error instanceof Error) || !('code' in error)) return false
  return ['EAUTH', 'ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'ETLS', 'EENVELOPE', 'EMESSAGE', 'EDNS', 'EPROTOCOL'].includes(String(error.code))
}

function requireMailEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new MailConfigurationError(`缺少邮件配置 ${name}`)
  return value
}

export async function deliverMailTask(task: MailTask): Promise<void> {
  let sending = false
  let smtpFailure: unknown
  try {
    const host = requireMailEnv('SMTP_HOST')
    const from = requireMailEnv('SMTP_FROM')
    const to = requireMailEnv('SMTP_TO')
    const port = Number(requireMailEnv('SMTP_PORT'))
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new MailConfigurationError('SMTP_PORT 必须是有效端口')
    const secure = process.env.SMTP_SECURE === 'true'
    const user = process.env.SMTP_USER?.trim()
    const auth = user ? { user, pass: requireMailEnv('SMTP_PASSWORD') } : undefined
    const inquiry = await pool.query(`SELECT payload,site_id,page_id FROM inquiries WHERE inquiry_id=$1`, [task.inquiryId])
    if (!inquiry.rowCount) throw new Error('询盘不存在')
    const messageId = `<olps-inquiry-${task.outboxId}@${from.includes('@') ? from.slice(from.lastIndexOf('@') + 1).replace(/[>\s]/g, '') : 'localhost'}>`
    const claimed = await pool.query(`UPDATE inquiry_email_outbox SET status='sending',attempts=attempts+1,message_id=$3
      WHERE outbox_id=$1 AND claim_token=$2 AND status='claimed' AND lease_expires_at>NOW() RETURNING outbox_id`,
      [task.outboxId, task.claimToken, messageId])
    if (!claimed.rowCount) return
    sending = true
    const transport = nodemailer.createTransport({ host, port, secure, auth, connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 60_000, ...(secure ? {} : { requireTLS: true }) })
    const row = inquiry.rows[0]!
    const result = await transport.sendMail({ from, to, messageId, subject: `网站询盘 #${task.inquiryId}`,
      text: `网站：${row.site_id ?? ''}\n页面：${row.page_id ?? ''}\n询盘：\n${JSON.stringify(row.payload, null, 2)}` }).catch((error: unknown) => {
        smtpFailure = error
        throw error
      })
    if (result.rejected.length) {
      const error = new MailDeliveryError(`邮件收件地址被拒绝：${result.rejected.join(', ')}`)
      smtpFailure = error
      throw error
    }
    await pool.query(`UPDATE inquiry_email_outbox SET status='sent',sent_at=NOW(),last_error=NULL,lease_expires_at=NULL
      WHERE outbox_id=$1 AND claim_token=$2 AND status='sending'`, [task.outboxId, task.claimToken])
  } catch (error) {
    if (!(error instanceof MailConfigurationError) && !(sending && error === smtpFailure && isSmtpError(error))) throw error
    const detail = error instanceof Error ? error.message : String(error)
    await pool.query(`UPDATE inquiry_email_outbox SET status=$3,last_error=$4,lease_expires_at=NULL
      WHERE outbox_id=$1 AND claim_token=$2 AND status IN ('claimed','sending')`,
      [task.outboxId, task.claimToken, sending ? 'uncertain' : 'failed', detail])
  }
}
