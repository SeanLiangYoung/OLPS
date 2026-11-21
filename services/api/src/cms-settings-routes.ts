import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Hono, type Context } from 'hono'
import { assertValidSchema, type ManagedSiteSettings, type SchemaName } from '@olps/domain'
import { requireAuth, type AuthVariables } from './auth-middleware.js'
import { managedResourceContext, resourceErrorResponse } from './managed-resource-context.js'
import { withDraftLock } from './draft-lock.js'
import { assertDraftOrdinaryEditAllowed } from './draft-ordinary-edit-guard.js'
import { ContentError } from './content-sandbox.js'

export const cmsSettingsRoutes = new Hono<{ Variables: AuthVariables }>()
function revision(bytes: Buffer): string { return `sha256:${createHash('sha256').update(bytes).digest('hex')}` }

async function readConfig(c: Context, file: string): Promise<{ value: Record<string, unknown>; revision: string }> {
  const context = await managedResourceContext(c)
  const bytes = await context.workspace.readFile(file)
  return { value: JSON.parse(bytes.toString('utf8')), revision: revision(bytes) }
}

async function saveConfig(c: Context, file: string, schema: SchemaName, value: unknown): Promise<string> {
  const expected = c.req.header('If-Match')?.replace(/^"|"$/g, '')
  if (!expected) throw new ContentError('REVISION_REQUIRED')
  assertValidSchema(schema, value, file)
  const context = await managedResourceContext(c)
  return withDraftLock(context.draftId, async () => {
    const client = await context.database.connect()
    let before: Buffer | undefined
    let written = false
    try {
      await client.query('BEGIN')
      const access = await client.query('SELECT d.* FROM site_drafts d JOIN draft_owners o USING(draft_id) WHERE d.draft_id=$1 AND o.user_id=$2 FOR UPDATE OF d', [context.draftId, context.userId])
      if (!access.rowCount) throw new ContentError('FORBIDDEN')
      assertDraftOrdinaryEditAllowed(access.rows[0])
      before = await context.workspace.readFile(file)
      if (revision(before) !== expected) throw new ContentError('REVISION_CONFLICT')
      if (schema === 'site-settings') {
        const current = JSON.parse(before.toString('utf8')) as ManagedSiteSettings
        const next = value as ManagedSiteSettings
        if (!isDeepStrictEqual(current.locales, next.locales)) {
          throw new ContentError('VALIDATION_FAILED', { field: 'locales', reason: '请通过语言设置新增语言，以同时创建完整的网站内容' })
        }
      }
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
      await context.workspace.writeFile(file, bytes)
      written = true
      await client.query("UPDATE site_drafts SET sync_status='dirty',updated_at=NOW() WHERE draft_id=$1", [context.draftId])
      await client.query('COMMIT')
      return revision(bytes)
    } catch (error) {
      await client.query('ROLLBACK')
      if (written && before) await context.workspace.writeFile(file, before)
      throw error
    } finally { client.release() }
  })
}
for (const config of [
  { path: 'settings', field: 'settings', file: 'source/site-settings.json', schema: 'site-settings' },
] as const) {
  cmsSettingsRoutes.get(`/drafts/:draftId/${config.path}`, requireAuth, async c => {
    try { const result = await readConfig(c, config.file); return c.json({ [config.field]: result.value, revision: result.revision }) }
    catch (error) { return resourceErrorResponse(error, c) }
  })
  cmsSettingsRoutes.put(`/drafts/:draftId/${config.path}`, requireAuth, async c => {
    try {
      const body = await c.req.json<Record<string, unknown>>()
      const result = await saveConfig(c, config.file, config.schema, body[config.field])
      return c.json({ revision: result })
    } catch (error) { return resourceErrorResponse(error, c) }
  })
}
