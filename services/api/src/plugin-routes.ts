import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type pg from 'pg'
import { assertValidSchema, type PluginsConfig } from '@olps/domain'
import { requireAuth, type AuthVariables } from './auth-middleware.js'
import { ContentError, withContentTransaction, type ContentContext } from './content-sandbox.js'
import { decryptCredential, encryptCredential } from './credentials.js'
import { installPackage, type PackageManifest } from './package-install.js'
import { expectedRevision, managedResourceContext, readResource, resourceErrorResponse, resourceId, resourceLimit, resourceRevision, resourceUsages, writeResource } from './managed-resource-context.js'

type SettingDefinition = { key: string; type: string; required: boolean; translatable?:boolean; default?: unknown; options?: Array<{ value: string }>; itemFields?: SettingDefinition[] }

function settingValueSchema(field:SettingDefinition):z.ZodType {
  if(['text','color'].includes(field.type))return z.string()
  if(field.type==='select')return z.string().refine(value=>field.options?.some(option=>option.value===value)===true)
  if(field.type==='richtext')return z.union([z.string(),z.object({type:z.literal('doc'),content:z.array(z.record(z.string(),z.unknown())).optional()}).strict()])
  if(field.type==='number')return z.number()
  if(field.type==='boolean')return z.boolean()
  const media=z.object({mediaId:z.string().min(1)}).strict()
  if(field.type==='media')return media
  if(field.type==='mediaList')return z.array(media)
  if(field.type==='link')return z.union([z.object({kind:z.literal('internal'),target:z.object({ref:z.enum(['page','collection','group','item']),id:z.string().min(1)}).strict()}).strict(),z.object({kind:z.literal('external'),url:z.string().regex(/^(https:|mailto:|tel:)/),newWindow:z.boolean()}).strict()])
  if(field.type==='list')return z.array(z.record(z.string(),z.unknown()))
  throw new ContentError('VALIDATION_FAILED',{field:field.key})
}

async function pluginManifest(context: ContentContext, id: string): Promise<PackageManifest> {
  const bytes = await readResource(context, `plugins/${resourceId(id)}/plugin.json`)
  if (!bytes) throw new ContentError('NOT_FOUND')
  const manifest = JSON.parse(bytes.toString('utf8')) as PackageManifest
  assertValidSchema('plugin', manifest, `plugins/${id}/plugin.json`)
  return manifest
}

async function configFor(context: ContentContext): Promise<{ config: PluginsConfig; bytes: Buffer }> {
  const bytes = await context.workspace.readFile('source/plugins.json')
  const config = JSON.parse(bytes.toString('utf8')) as PluginsConfig
  assertValidSchema('plugins', config, 'source/plugins.json')
  return { config, bytes }
}

async function siteFor(context: ContentContext,client:pg.PoolClient): Promise<string> {
  const result = await client.query('SELECT site_id FROM site_drafts WHERE draft_id=$1', [context.draftId])
  if (!result.rowCount || !result.rows[0].site_id) throw new ContentError('NOT_FOUND')
  return result.rows[0].site_id
}

function safeSettings(fields: SettingDefinition[], values: Record<string, unknown>, secrets: Record<string, string>, prefix = '', allowedSecrets = new Set<string>(),locales=new Set<string>()): { settings: Record<string, unknown>; allowedSecrets: Set<string> } {
  if (!values || Array.isArray(values) || typeof values !== 'object') throw new ContentError('VALIDATION_FAILED', { field: 'settings' })
  if (Object.keys(values).some(key => !fields.some(field => field.key === key))) throw new ContentError('VALIDATION_FAILED', { field: 'settings' })
  const settings: Record<string, unknown> = {}
  for (const field of fields) {
    const key = prefix ? `${prefix}.${field.key}` : field.key
    const supplied = Object.prototype.hasOwnProperty.call(values, field.key)
    const value = supplied ? values[field.key] : field.type === 'secret' ? undefined : field.default
    if (field.type === 'secret') {
      allowedSecrets.add(key)
      if (value === null) delete secrets[key]
      else if (value !== undefined) {
        if (typeof value !== 'string') throw new ContentError('VALIDATION_FAILED', { field: key })
        secrets[key] = value
      }
      if (field.required && !secrets[key]) throw new ContentError('VALIDATION_FAILED', { field: key })
      continue
    }
    if (value === undefined || value === null) {
      if (field.required) throw new ContentError('VALIDATION_FAILED', { field: key })
      if (value === null) settings[field.key] = null
      continue
    }
    const schema=settingValueSchema(field)
    if(field.translatable&&typeof value==='object'&&!Array.isArray(value)&&!schema.safeParse(value).success){
      z.record(z.string().refine(locale=>locales.has(locale)),schema.nullable()).parse(value)
      settings[field.key]=Object.fromEntries(Object.entries(value).map(([locale,translated])=>[locale,safeSettings([{...field,translatable:false}],{[field.key]:translated},secrets,prefix,allowedSecrets,locales).settings[field.key]]))
      continue
    }
    schema.parse(value)
    if (field.type === 'list') {
      if (Array.isArray(value)) {
        settings[field.key] = value.map((item, index) => safeSettings(field.itemFields ?? [], item, secrets, `${key}[${index}]`, allowedSecrets,locales).settings)
        continue
      }
    }
    settings[field.key] = value
  }
  return { settings, allowedSecrets }
}

export async function readPluginSettings(context: ContentContext, id: string): Promise<{ enabled: boolean; settings: Record<string, unknown>; secrets: Record<string, boolean>; revision: string; permissions: Record<string, unknown> }> {
  return withContentTransaction(context, false, async client => {
    const manifest = await pluginManifest(context, id)
    const { config, bytes } = await configFor(context)
    const entry = config.plugins[id]
    if (!entry) throw new ContentError('NOT_FOUND')
    const row = await client.query('SELECT ciphertext FROM plugin_secrets WHERE draft_id=$1 AND plugin_id=$2', [context.draftId, id])
    const secrets = row.rowCount ? JSON.parse(decryptCredential(row.rows[0].ciphertext, `${await siteFor(context,client)}/${id}`)) as Record<string, string> : {}
    return { enabled: entry.enabled, settings: entry.settings, secrets: Object.fromEntries(Object.keys(secrets).map(key => [key, true])), revision: resourceRevision(Buffer.concat([bytes, Buffer.from(row.rowCount ? row.rows[0].ciphertext : '')])), permissions: manifest.permissions ?? {} }
  })
}

export async function savePluginSettings(context: ContentContext, id: string, settings: Record<string, unknown>, updates: Record<string, string | null>, revision: string) {
  return withContentTransaction(context, true, async (client, backups) => {
    const manifest = await pluginManifest(context, id)
    const { config, bytes } = await configFor(context)
    const entry = config.plugins[id]
    if (!entry) throw new ContentError('NOT_FOUND')
    if (!updates || Array.isArray(updates) || typeof updates !== 'object' || Object.keys(updates).some(key => !manifest.settings.some(field => field.key === key && field.type === 'secret'))) throw new ContentError('VALIDATION_FAILED', { field: 'secrets' })
    const siteId = await siteFor(context,client)
    const previous = await client.query('SELECT ciphertext FROM plugin_secrets WHERE draft_id=$1 AND plugin_id=$2', [context.draftId, id])
    const currentRevision = resourceRevision(Buffer.concat([bytes, Buffer.from(previous.rowCount ? previous.rows[0].ciphertext : '')]))
    if (currentRevision !== revision) throw new ContentError('REVISION_CONFLICT', { currentRevision })
    const secrets = previous.rowCount ? JSON.parse(decryptCredential(previous.rows[0].ciphertext, `${siteId}/${id}`)) as Record<string, string> : {}
    const siteSettings=JSON.parse((await context.workspace.readFile('source/site-settings.json')).toString()) as {locales:Array<{code:string}>}
    const sanitized = safeSettings(manifest.settings as SettingDefinition[], { ...entry.settings, ...settings, ...updates }, secrets,'',new Set(),new Set(siteSettings.locales.map(locale=>locale.code)))
    for (const key of Object.keys(secrets)) if (!sanitized.allowedSecrets.has(key)) delete secrets[key]
    entry.settings = sanitized.settings
    assertValidSchema('plugins', config, 'source/plugins.json')
    const ciphertext = Object.keys(secrets).length ? encryptCredential(JSON.stringify(secrets), `${siteId}/${id}`) : ''
    if (ciphertext) {
      await client.query('INSERT INTO plugin_secrets(draft_id,site_id,plugin_id,ciphertext) VALUES($1,$2,$3,$4) ON CONFLICT(draft_id,plugin_id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=NOW()', [context.draftId, siteId, id, ciphertext])
    } else await client.query('DELETE FROM plugin_secrets WHERE draft_id=$1 AND plugin_id=$2', [context.draftId, id])
    const next = Buffer.from(`${JSON.stringify(config, null, 2)}\n`)
    await writeResource(context, backups, 'source/plugins.json', next)
    return { settings: entry.settings, secrets: Object.fromEntries(Object.keys(secrets).map(key => [key, true])), revision: resourceRevision(Buffer.concat([next, Buffer.from(ciphertext)])) }
  })
}

export async function setPluginEnabled(context: ContentContext, id: string, enabled: boolean, confirmPermissions: boolean, revision?: string) {
  return withContentTransaction(context, true, async (client, backups) => {
    const manifest = await pluginManifest(context, id)
    const { config, bytes } = await configFor(context)
    if (revision && resourceRevision(bytes) !== revision) throw new ContentError('REVISION_CONFLICT', { currentRevision: resourceRevision(bytes) })
    const entry = config.plugins[id]
    if (!entry) throw new ContentError('NOT_FOUND')
    if (enabled && Object.keys(manifest.server ?? {}).length && !entry.permissionsAcceptedAt) {
      if (!confirmPermissions) throw new ContentError('PERMISSIONS_REQUIRED', { permissions: manifest.permissions })
      const access = await client.query('SELECT 1 FROM site_owners WHERE site_id=(SELECT site_id FROM site_drafts WHERE draft_id=$1) AND user_id=$2', [context.draftId, context.userId])
      if (!access.rowCount) throw new ContentError('FORBIDDEN')
      entry.permissionsAcceptedAt = new Date().toISOString()
      entry.permissionsAcceptedBy = context.userId
    }
    const usages = enabled ? [] : await resourceUsages(context, record => typeof record.type === 'string' && record.type.startsWith(`plugin/${id}/`))
    entry.enabled = enabled
    assertValidSchema('plugins', config, 'source/plugins.json')
    const next = Buffer.from(`${JSON.stringify(config, null, 2)}\n`)
    await writeResource(context, backups, 'source/plugins.json', next)
    return { enabled, permissions: manifest.permissions ?? {}, usages, revision: resourceRevision(next) }
  })
}

export async function deletePlugin(context: ContentContext, id: string, revision: string): Promise<void> {
  await withContentTransaction(context, true, async (client, backups) => {
    await pluginManifest(context, id)
    if (['inquiry-form', 'whatsapp', 'google-maps'].includes(id)) throw new ContentError('RESOURCE_IN_USE', { reason: '内置插件不能删除' })
    const { config, bytes } = await configFor(context)
    if (resourceRevision(bytes) !== revision) throw new ContentError('REVISION_CONFLICT')
    const usages = await resourceUsages(context, record => typeof record.type === 'string' && record.type.startsWith(`plugin/${id}/`))
    if (usages.length || config.plugins[id]?.enabled) throw new ContentError('RESOURCE_IN_USE', { usages, count: usages.length })
    delete config.plugins[id]
    await client.query('DELETE FROM plugin_secrets WHERE draft_id=$1 AND plugin_id=$2', [context.draftId, id])
    for (const file of await context.workspace.listFiles(`plugins/${id}/`)) await writeResource(context, backups, file, null)
    await writeResource(context, backups, 'source/plugins.json', Buffer.from(`${JSON.stringify(config, null, 2)}\n`))
  })
}

export const pluginRoutes = new Hono<{ Variables: AuthVariables }>()
pluginRoutes.use('/drafts/:draftId/plugins', requireAuth)
pluginRoutes.use('/drafts/:draftId/plugins/*', requireAuth)
pluginRoutes.get('/drafts/:draftId/plugins', async c => {
  try {
    const context = await managedResourceContext(c)
    return c.json(await withContentTransaction(context, false, async () => {
      const { config, bytes } = await configFor(context)
      const plugins = []
      for (const file of await context.workspace.listFiles('plugins')) {
        if (!/^plugins\/[^/]+\/plugin\.json$/.test(file)) continue
        const id = file.split('/')[1]
        plugins.push({ manifest: await pluginManifest(context, id), config: config.plugins[id] ?? null })
      }
      return { plugins, revision: resourceRevision(bytes) }
    }))
  } catch (error) { return resourceErrorResponse(error, c) }
})
pluginRoutes.post('/drafts/:draftId/plugins', bodyLimit({ maxSize: resourceLimit('PLUGIN_MAX_BYTES', 100 * 1024 * 1024) + 64 * 1024 }), async c => {
  try {
    const context = await managedResourceContext(c)
    const body = await c.req.parseBody()
    if (!(body.file instanceof File)) throw new ContentError('VALIDATION_FAILED', { field: 'file' })
    return c.json(await installPackage(context, Buffer.from(await body.file.arrayBuffer()), 'plugin'), 201)
  } catch (error) { return resourceErrorResponse(error, c) }
})
pluginRoutes.put('/drafts/:draftId/plugins/:pluginId', async c => {
  try {
    const body = z.object({ enabled: z.boolean(), confirmPermissions: z.boolean().optional() }).strict().parse(await c.req.json())
    return c.json(await setPluginEnabled(await managedResourceContext(c), c.req.param('pluginId'), body.enabled, body.confirmPermissions === true, expectedRevision(c)))
  } catch (error) { return resourceErrorResponse(error, c) }
})
pluginRoutes.get('/drafts/:draftId/plugins/:pluginId/settings', async c => {
  try { return c.json(await readPluginSettings(await managedResourceContext(c), c.req.param('pluginId'))) }
  catch (error) { return resourceErrorResponse(error, c) }
})
pluginRoutes.put('/drafts/:draftId/plugins/:pluginId/settings', async c => {
  try {
    const body = z.object({ settings: z.record(z.string(), z.unknown()), secrets: z.record(z.string(), z.string().nullable()).optional() }).strict().parse(await c.req.json())
    return c.json(await savePluginSettings(await managedResourceContext(c), c.req.param('pluginId'), body.settings, body.secrets ?? {}, expectedRevision(c)))
  } catch (error) { return resourceErrorResponse(error, c) }
})
pluginRoutes.delete('/drafts/:draftId/plugins/:pluginId', async c => {
  try { await deletePlugin(await managedResourceContext(c), c.req.param('pluginId'), expectedRevision(c)); return c.body(null, 204) }
  catch (error) { return resourceErrorResponse(error, c) }
})
pluginRoutes.get('/drafts/:draftId/plugins/:pluginId/logs', async c => {
  try {
    const context = await managedResourceContext(c)
    const id = resourceId(c.req.param('pluginId'))
    const logs = await withContentTransaction(context, false, async client => {
      await pluginManifest(context, id)
      return (await client.query('SELECT log_id,level,message,meta,created_at FROM plugin_logs WHERE draft_id=$1 AND plugin_id=$2 ORDER BY log_id DESC LIMIT 100', [context.draftId, id])).rows
    })
    return c.json({ logs })
  } catch (error) { return resourceErrorResponse(error, c) }
})
