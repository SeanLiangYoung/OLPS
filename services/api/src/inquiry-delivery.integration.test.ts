import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { SMTPServer } from 'smtp-server'
import { expect, it } from 'vitest'
import { migrateWithClient } from './db.js'
import { migrateCmsSchema } from './cms-schema.js'
import { createCmsPublicSchema } from './cms-public.js'
import { createIntegrationSchema } from './integration-schema.js'
import { createUnpublishedSite } from './site-lifecycle.js'
import { runInquiryDeliveries, retryInquiryDelivery } from './inquiry-delivery.js'

it('真实SMTP发送询盘一次，并保留失败状态、广告同意保护和预览隔离', async () => {
  const schema = `delivery_${randomUUID().replaceAll('-', '')}`
  const url = process.env.TEST_DATABASE_URL!
  if (!new URL(url).pathname.includes('_test_')) throw new Error('只允许测试数据库')
  const admin = new pg.Client({ connectionString: url })
  await admin.connect(); await admin.query(`CREATE SCHEMA ${schema}`)
  const database = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
  const client = await database.connect()
  const messages: string[] = []
  const smtp = new SMTPServer({ secure: false, authOptional: true, disabledCommands: ['STARTTLS'], onRcptTo(address, _session, callback) { callback(address.address === 'rejected@example.com' ? new Error('Recipient rejected') : undefined) }, onData(stream, _session, callback) { let message = ''; stream.on('data', bytes => { message += bytes.toString() }); stream.on('end', () => { messages.push(message); callback() }) } })
  await new Promise<void>(resolve => smtp.listen(0, '127.0.0.1', resolve))
  const original = { SMTP_HOST: process.env.SMTP_HOST, SMTP_PORT: process.env.SMTP_PORT, SMTP_SECURE: process.env.SMTP_SECURE, SMTP_FROM: process.env.SMTP_FROM, SMTP_TO: process.env.SMTP_TO }
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String((smtp.server.address() as { port: number }).port), SMTP_SECURE: 'false', SMTP_FROM: 'sender@example.com', SMTP_TO: 'sales@example.com' })
  try {
    await migrateWithClient(client); await migrateCmsSchema(client); await createCmsPublicSchema(client); await createIntegrationSchema(client)
    await client.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    const site = await createUnpublishedSite({ userId: 'owner', name: 'Delivery', settings: {}, sandboxId: randomUUID() }, database)
    const payload = { eventId: randomUUID(), fields: { name: 'Visitor', email: 'visitor@example.com', message: 'Delivery integration inquiry' }, consent: { advertising: false, analytics: false }, attribution: {}, contentTitle: 'Contact' }
    const inquiry = (await client.query("INSERT INTO inquiries(site_id,source,cms_id,payload,status) VALUES($1,'public',$2,$3,'new') RETURNING inquiry_id", [site.siteId, randomUUID(), payload])).rows[0].inquiry_id
    for (const kind of ['email', 'submit_conversion']) await client.query("INSERT INTO cms_outbound_tasks(task_id,inquiry_id,site_id,kind,status) VALUES($1,$2,$3,$4,'pending')", [randomUUID(), inquiry, site.siteId, kind])
    await Promise.all([runInquiryDeliveries(database), runInquiryDeliveries(database)])
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('Delivery integration inquiry')
    expect(messages[0]).toContain('visitor@example.com')
    expect((await client.query("SELECT status,attempts FROM cms_outbound_tasks WHERE kind='email'")).rows).toEqual([{ status: 'completed', attempts: 1 }])
    expect((await client.query("SELECT status,last_error FROM cms_outbound_tasks WHERE kind='submit_conversion'")).rows).toEqual([{ status: 'blocked', last_error: 'ADVERTISING_CONSENT_REQUIRED' }])
    const preview = (await client.query("INSERT INTO inquiries(site_id,source,cms_id,payload,status) VALUES($1,'preview',$2,$3,'new') RETURNING inquiry_id", [site.siteId, randomUUID(), payload])).rows[0].inquiry_id
    await client.query("INSERT INTO cms_outbound_tasks(task_id,inquiry_id,site_id,kind,status) VALUES($1,$2,$3,'email','pending')", [randomUUID(), preview, site.siteId])
    await runInquiryDeliveries(database)
    expect(messages).toHaveLength(1)
    expect((await client.query('SELECT status,last_error FROM cms_outbound_tasks WHERE inquiry_id=$1', [preview])).rows).toEqual([{ status: 'blocked', last_error: 'PREVIEW_EXTERNAL_SEND_DISABLED' }])
    const rejectedId = randomUUID()
    const rejectedCmsId = randomUUID()
    const rejectedInquiry = (await client.query("INSERT INTO inquiries(site_id,source,cms_id,payload,status) VALUES($1,'public',$2,$3,'new') RETURNING inquiry_id", [site.siteId, rejectedCmsId, { ...payload, notificationEmail: 'rejected@example.com' }])).rows[0].inquiry_id
    await client.query("INSERT INTO cms_outbound_tasks(task_id,inquiry_id,site_id,kind,status) VALUES($1,$2,$3,'email','pending')", [rejectedId, rejectedInquiry, site.siteId])
    await runInquiryDeliveries(database)
    expect((await client.query('SELECT status FROM cms_outbound_tasks WHERE task_id=$1', [rejectedId])).rows[0].status).toBe('failed')
    await expect(retryInquiryDelivery('outsider', site.siteId, rejectedCmsId, rejectedId, database)).rejects.toThrow('NOT_FOUND')
    await client.query('UPDATE inquiries SET payload=$1 WHERE inquiry_id=$2', [payload, rejectedInquiry])
    await retryInquiryDelivery('owner', site.siteId, rejectedCmsId, rejectedId, database)
    await runInquiryDeliveries(database)
    expect(messages).toHaveLength(2)
    expect((await client.query('SELECT status,attempts FROM cms_outbound_tasks WHERE task_id=$1', [rejectedId])).rows).toEqual([{ status: 'completed', attempts: 2 }])
    await expect(retryInquiryDelivery('owner', site.siteId, rejectedCmsId, rejectedId, database)).rejects.toThrow('NOT_FOUND')
    delete process.env.SMTP_HOST
    const failedTask = randomUUID()
    await client.query("INSERT INTO cms_outbound_tasks(task_id,inquiry_id,site_id,kind,status) VALUES($1,$2,$3,'email_retry','pending')", [failedTask, inquiry, site.siteId])
    await runInquiryDeliveries(database)
    expect((await client.query('SELECT status,last_error FROM cms_outbound_tasks WHERE task_id=$1', [failedTask])).rows[0].status).toBe('failed')
    expect(messages).toHaveLength(2)
  } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    await new Promise<void>(resolve => smtp.close(resolve))
    client.release(); await database.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end()
  }
}, 30000)
