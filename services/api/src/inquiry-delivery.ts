import nodemailer from 'nodemailer'
import type pg from 'pg'
import { z } from 'zod'
import { pool } from './db.js'
import { dispatchConversion } from './integration-routes.js'

class DeliveryBlockedError extends Error {}

export async function retryInquiryDelivery(userId: string, siteId: string, inquiryId: string, taskId: string, database: pg.Pool = pool): Promise<void> {
  const result = await database.query("UPDATE cms_outbound_tasks t SET status='pending',last_error=NULL FROM inquiries i,site_owners o WHERE t.inquiry_id=i.inquiry_id AND o.site_id=t.site_id AND o.user_id=$1 AND t.site_id=$2 AND i.cms_id=$3 AND t.task_id=$4 AND i.source='public' AND t.status IN ('failed','blocked') RETURNING t.task_id", [userId, siteId, inquiryId, taskId])
  if (!result.rowCount) throw new Error('NOT_FOUND')
}

async function sendInquiryEmail(task: Record<string, any>): Promise<void> {
  const host = process.env.SMTP_HOST?.trim()
  const from = process.env.SMTP_FROM?.trim()
  const to = task.payload.notificationEmail || process.env.SMTP_TO?.trim()
  if (!host || !from || !to) throw new DeliveryBlockedError('邮件通知设置尚未填写完整，请联系管理员。')
  const port = Number(process.env.SMTP_PORT ?? '587')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('邮件服务器端口无效')
  z.email().parse(from); z.email().parse(to)
  const user = process.env.SMTP_USER?.trim()
  const password = process.env.SMTP_PASSWORD
  if (user && !password) throw new DeliveryBlockedError('邮件服务登录密码尚未配置，请联系管理员。')
  const transport = nodemailer.createTransport({ host, port, secure: process.env.SMTP_SECURE === 'true', auth: user ? { user, pass: password } : undefined, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 })
  try {
    const fields = task.payload.fields
    const result = await transport.sendMail({ from, to, replyTo: fields.email, messageId: `<olps-${task.task_id}@inquiry.local>`, subject: `网站询盘：${task.payload.contentTitle ?? '联系页面'}`, text: `姓名：${fields.name}\n邮箱：${fields.email}\n\n${fields.message}\n\n询盘编号：${task.cms_id}` })
    if (!result.accepted?.length || result.rejected?.length) throw new Error('SMTP 未接受询盘邮件的全部收件地址')
  } finally { transport.close() }
}

export async function runInquiryDeliveries(database: pg.Pool = pool, maximum = 20): Promise<Array<{ taskId: string; status: string }>> {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) throw new Error('交付批量数量无效')
  const results: Array<{ taskId: string; status: string }> = []
  for (let index = 0; index < maximum; index++) {
    const client = await database.connect()
    try {
      await client.query('BEGIN')
      const task = (await client.query("SELECT t.*,i.source,i.cms_id,i.cms_event_id,i.payload,i.created_at AS inquiry_created_at FROM cms_outbound_tasks t JOIN inquiries i USING(inquiry_id) WHERE t.status='pending' ORDER BY t.created_at,t.task_id FOR UPDATE OF t SKIP LOCKED LIMIT 1")).rows[0]
      if (!task) { await client.query('COMMIT'); break }
      let status = 'completed'
      let error: string | null = null
      try {
        if (task.source !== 'public') throw new DeliveryBlockedError('PREVIEW_EXTERNAL_SEND_DISABLED')
        if (task.kind === 'email') await sendInquiryEmail(task)
        else if (task.kind === 'submit_conversion' || task.kind === 'qualified_conversion') {
          const delivered = await dispatchConversion({ siteId: task.site_id, source: 'public', inquiryId: task.inquiry_id, eventId: task.payload.eventId, kind: task.kind === 'submit_conversion' ? 'submit' : 'qualified', dateTime: new Date(task.inquiry_created_at).toISOString(), consent: { advertising: task.payload.consent?.advertising === true }, email: task.payload.fields.email, attribution: task.payload.attribution, sourceUrl: task.payload.attribution?.sourceUrl }, database)
          status = delivered.status
          error = delivered.reason ?? (status === 'failed' ? '第三方转化发送失败，请检查营销连接' : null)
        } else throw new Error(`询盘交付类型无效：${task.kind}`)
      } catch (reason) {
        status = reason instanceof DeliveryBlockedError ? 'blocked' : 'failed'
        error = reason instanceof Error ? reason.message : String(reason)
      }
      await client.query('UPDATE cms_outbound_tasks SET status=$1,last_error=$2,attempts=attempts+1 WHERE task_id=$3', [status, error, task.task_id])
      await client.query('COMMIT')
      results.push({ taskId: task.task_id, status })
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  return results
}

export function startInquiryDeliveries(database: pg.Pool = pool): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try { await runInquiryDeliveries(database) } finally { running = false }
  }
  const timer = setInterval(() => { void tick() }, 5000)
  timer.unref()
  void tick()
  return () => clearInterval(timer)
}
