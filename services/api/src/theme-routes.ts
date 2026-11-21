import { Hono } from 'hono'
import { packageFixedStrings } from './fixed-strings.js'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import mime from 'mime-types'
import { assertValidSchema, type AppearanceConfig } from '@olps/domain'
import { requireAuth, type AuthVariables } from './auth-middleware.js'
import { ContentError, withContentTransaction, type ContentContext } from './content-sandbox.js'
import { installPackage, type PackageManifest } from './package-install.js'
import { expectedRevision, managedResourceContext, readResource, resourceErrorResponse, resourceId, resourceLimit, resourceRevision, resourceUsages, writeResource } from './managed-resource-context.js'

async function themeManifest(context: ContentContext, id: string): Promise<PackageManifest> {
  const bytes = await readResource(context, `themes/${resourceId(id)}/theme.json`)
  if (!bytes) throw new ContentError('NOT_FOUND')
  const manifest = JSON.parse(bytes.toString('utf8')) as PackageManifest
  assertValidSchema('theme', manifest, `themes/${id}/theme.json`)
  return manifest
}

export async function readAppearance(context: ContentContext): Promise<{ appearance: AppearanceConfig; revision: string }> {
  return withContentTransaction(context, false, async () => {
    const bytes = await context.workspace.readFile('source/appearance.json')
    const appearance = JSON.parse(bytes.toString('utf8')) as AppearanceConfig
    assertValidSchema('appearance', appearance, 'source/appearance.json')
    return { appearance, revision: resourceRevision(bytes) }
  })
}

export async function setActiveTheme(context: ContentContext, id: string, confirmImpact: boolean, expected?: string) {
  return withContentTransaction(context, true, async (_client, backups) => {
    const manifest = await themeManifest(context, id)
    const bytes = await context.workspace.readFile('source/appearance.json')
    const revision = resourceRevision(bytes)
    if (expected && revision !== expected) throw new ContentError('REVISION_CONFLICT', { currentRevision: revision })
    const appearance = JSON.parse(bytes.toString('utf8')) as AppearanceConfig
    const prefix = `themes/${id}/sections/`
    const available = new Set((await context.workspace.listFiles(prefix)).filter(file => file.endsWith('/section.json')).map(file => `theme/${file.slice(prefix.length).split('/')[0]}`))
    const usages = await resourceUsages(context, record => typeof record.type === 'string' && record.type.startsWith('theme/') && !available.has(record.type))
    if (usages.length && !confirmImpact) throw new ContentError('THEME_CHANGE_REQUIRES_CONFIRMATION', { usages, count: usages.length })
    appearance.themeId = id
    appearance.themeSettings = Object.fromEntries(manifest.settings.filter(field => field.default !== undefined).map(field => [field.key, field.default]))
    assertValidSchema('appearance', appearance, 'source/appearance.json')
    const next = Buffer.from(`${JSON.stringify(appearance, null, 2)}\n`)
    await writeResource(context, backups, 'source/appearance.json', next)
    return { appearance, revision: resourceRevision(next), usages }
  })
}

export async function saveAppearance(context: ContentContext, appearance: AppearanceConfig, revision: string) {
  assertValidSchema('appearance', appearance, 'source/appearance.json')
  return withContentTransaction(context, true, async (_client, backups) => {
    const previous = await context.workspace.readFile('source/appearance.json')
    if (resourceRevision(previous) !== revision) throw new ContentError('REVISION_CONFLICT', { currentRevision: resourceRevision(previous) })
    const current = JSON.parse(previous.toString('utf8')) as AppearanceConfig
    if (current.themeId !== appearance.themeId) throw new ContentError('VALIDATION_FAILED', { reason: '切换主题需要使用主题启用接口' })
    await themeManifest(context, appearance.themeId)
    const bytes = Buffer.from(`${JSON.stringify(appearance, null, 2)}\n`)
    await writeResource(context, backups, 'source/appearance.json', bytes)
    return { appearance, revision: resourceRevision(bytes) }
  })
}

export async function deleteTheme(context: ContentContext, id: string, revision: string): Promise<void> {
  await withContentTransaction(context, true, async (_client, backups) => {
    await themeManifest(context, id)
    const bytes = await context.workspace.readFile('source/appearance.json')
    if (resourceRevision(bytes) !== revision) throw new ContentError('REVISION_CONFLICT')
    const appearance = JSON.parse(bytes.toString('utf8')) as AppearanceConfig
    if (appearance.themeId === id) throw new ContentError('RESOURCE_IN_USE', { reason: '当前启用的主题不能删除' })
    for (const file of await context.workspace.listFiles(`themes/${id}/`)) await writeResource(context, backups, file, null)
  })
}

export const themeRoutes = new Hono<{ Variables: AuthVariables }>()
themeRoutes.use('/drafts/:draftId/themes', requireAuth)
themeRoutes.use('/drafts/:draftId/themes/*', requireAuth)
themeRoutes.use('/drafts/:draftId/appearance', requireAuth)
themeRoutes.use('/drafts/:draftId/i18n/*', requireAuth)
themeRoutes.get('/drafts/:draftId/themes', async c => {
  try {
    const context = await managedResourceContext(c)
    const active = await readAppearance(context)
    const themes = await withContentTransaction(context, false, async () => {
      const result = []
      for (const file of await context.workspace.listFiles('themes')) if (/^themes\/[^/]+\/theme\.json$/.test(file)) {
        const id = file.split('/')[1]
        result.push({ manifest: await themeManifest(context, id), active: active.appearance.themeId === id })
      }
      return result
    })
    return c.json({ themes, revision: active.revision })
  } catch (error) { return resourceErrorResponse(error, c) }
})
themeRoutes.post('/drafts/:draftId/themes', bodyLimit({ maxSize: resourceLimit('THEME_MAX_BYTES', 100 * 1024 * 1024) + 64 * 1024 }), async c => {
  try {
    const context = await managedResourceContext(c)
    const body = await c.req.parseBody()
    if (!(body.file instanceof File)) throw new ContentError('VALIDATION_FAILED', { field: 'file' })
    return c.json(await installPackage(context, Buffer.from(await body.file.arrayBuffer()), 'theme'), 201)
  } catch (error) { return resourceErrorResponse(error, c) }
})
themeRoutes.post('/drafts/:draftId/themes/:themeId/activate', async c => {
  try {
    const input = z.object({ confirmImpact: z.boolean().optional() }).strict().parse(await c.req.json())
    return c.json(await setActiveTheme(await managedResourceContext(c), c.req.param('themeId'), input.confirmImpact === true, expectedRevision(c)))
  } catch (error) { return resourceErrorResponse(error, c) }
})
themeRoutes.delete('/drafts/:draftId/themes/:themeId', async c => {
  try { await deleteTheme(await managedResourceContext(c), c.req.param('themeId'), expectedRevision(c)); return c.body(null, 204) }
  catch (error) { return resourceErrorResponse(error, c) }
})
themeRoutes.get('/drafts/:draftId/themes/:themeId/files/*', async c => {
  try {
    const context = await managedResourceContext(c)
    const id = resourceId(c.req.param('themeId'))
    const prefix = `/drafts/${c.req.param('draftId')}/themes/${id}/files/`
    const relative = decodeURIComponent(c.req.path.slice(c.req.path.indexOf(prefix) + prefix.length))
    if (!relative || relative.split('/').some(part => part === '..' || part === '.' || part === '.git') || relative.includes('\\') || relative.includes('\0') || relative.startsWith('/')) throw new ContentError('VALIDATION_FAILED')
    const bytes = await withContentTransaction(context, false, async () => {
      await themeManifest(context, id)
      const bytes = await readResource(context, `themes/${id}/${relative}`)
      if (!bytes) throw new ContentError('NOT_FOUND')
      return bytes
    })
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': mime.lookup(relative) || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" } })
  } catch (error) { return resourceErrorResponse(error, c) }
})
themeRoutes.get('/drafts/:draftId/appearance', async c => {
  try { return c.json(await readAppearance(await managedResourceContext(c))) }
  catch (error) { return resourceErrorResponse(error, c) }
})
themeRoutes.put('/drafts/:draftId/appearance', async c => {
  try { return c.json(await saveAppearance(await managedResourceContext(c), await c.req.json(), expectedRevision(c))) }
  catch (error) { return resourceErrorResponse(error, c) }
})
themeRoutes.get('/drafts/:draftId/i18n/:locale', async c => {
  try {
    const context = await managedResourceContext(c)
    const file = `source/i18n/${resourceId(c.req.param('locale'))}.json`
    return c.json(await withContentTransaction(context, false, async () => {
      const bytes = await readResource(context, file)
      if (!bytes) throw new ContentError('NOT_FOUND')
      const i18n = JSON.parse(bytes.toString('utf8'))
      i18n.strings = { ...await packageFixedStrings(context,c.req.param('locale')), ...i18n.strings }
      return { i18n, revision: resourceRevision(bytes) }
    }))
  } catch (error) { return resourceErrorResponse(error, c) }
})
themeRoutes.put('/drafts/:draftId/i18n/:locale', async c => {
  try {
    const context = await managedResourceContext(c)
    const file = `source/i18n/${resourceId(c.req.param('locale'))}.json`
    const input = await c.req.json()
    assertValidSchema('i18n', input, file)
    const revision = expectedRevision(c)
    return c.json(await withContentTransaction(context, true, async (_client, backups) => {
      const previous = await readResource(context, file)
      if (!previous) throw new ContentError('NOT_FOUND')
      if (resourceRevision(previous) !== revision) throw new ContentError('REVISION_CONFLICT')
      const next = Buffer.from(`${JSON.stringify(input, null, 2)}\n`)
      await writeResource(context, backups, file, next)
      return { i18n: input, revision: resourceRevision(next) }
    }))
  } catch (error) { return resourceErrorResponse(error, c) }
})
