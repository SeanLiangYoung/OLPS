import path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { assertValidSchema, canonicalizeLocale, type ManagedSiteSettings, type SchemaName } from '@olps/domain'
import { requireAuth, type AuthVariables } from './auth-middleware.js'
import { ContentError, withContentTransaction, type ContentContext } from './content-sandbox.js'
import { indexContent } from './content-index.js'
import { packageFixedStrings } from './fixed-strings.js'
import { expectedRevision, managedResourceContext, resourceErrorResponse, resourceRevision, writeResource } from './managed-resource-context.js'

export async function addSiteLocale(context: ContentContext, code: string, dir: 'ltr'|'rtl', revision?: string): Promise<{ created: number; settings: ManagedSiteSettings; revision: string }> {
  try { if (canonicalizeLocale(code) !== code) throw new ContentError('VALIDATION_FAILED', { field: 'code' }) }
  catch(error) { if(error instanceof RangeError)throw new ContentError('VALIDATION_FAILED',{field:'code'});throw error }
  return withContentTransaction(context, true, async (client, backups) => {
    const bytes = await context.workspace.readFile('source/site-settings.json')
    if (revision && resourceRevision(bytes) !== revision) throw new ContentError('REVISION_CONFLICT')
    const settings = JSON.parse(bytes.toString()) as ManagedSiteSettings
    if (settings.locales.some(locale => locale.code === code)) throw new ContentError('VALIDATION_FAILED', { field: 'code' })
    const files = await context.workspace.listFiles('source')
    const sources = files.filter(file => /^source\/pages\/[^/]+\/page\.json$/.test(file) || /^source\/collections\/[^/]+\.json$/.test(file) || /^source\/collections\/[^/]+\/(groups|items)\/[^/]+\/(group|item)\.json$/.test(file)).map(file => /^source\/collections\/[^/]+\.json$/.test(file) ? `${file.slice(0,-5)}/index/${settings.defaultLocale}.json` : `${path.posix.dirname(file)}/${settings.defaultLocale}.json`)
    let created = 0
    for (const source of sources) {
      const parts = source.split('/')
      const ref = parts[1] === 'pages' ? 'page' : parts[3] === 'index' ? 'collection' : parts[3] === 'groups' ? 'group' : parts[3] === 'items' ? 'item' : null
      if (!ref) throw new ContentError('VALIDATION_FAILED', { field: source })
      const id = ref === 'page' || ref === 'collection' ? parts[2] : parts[4]
      const metaPath = ref === 'collection' ? `source/collections/${id}.json` : `${path.posix.dirname(source)}/${ref}.json`
      const meta = JSON.parse((await context.workspace.readFile(metaPath)).toString()) as Record<string, unknown>
      const localized = JSON.parse((await context.workspace.readFile(source)).toString()) as Record<string, unknown>
      localized.locale = code
      localized.sourceHash = null
      localized.updatedAt = new Date().toISOString()
      const target = `${path.posix.dirname(source)}/${code}.json`
      if (files.includes(target)) throw new ContentError('VALIDATION_FAILED', { field: target })
      assertValidSchema((ref === 'collection' ? 'collection-index-locale' : `${ref}-locale`) as SchemaName, localized, target, ref === 'page' ? { pageRole: meta.role as never } : undefined)
      const output = Buffer.from(`${JSON.stringify(localized, null, 2)}\n`)
      await indexContent(client, context.draftId, ref, id, ref === 'page' ? undefined : parts[2], meta, localized, resourceRevision(output))
      await writeResource(context, backups, target, output)
      created++
    }
    for (const kind of ['themes','plugins']) for (const file of await context.workspace.listFiles(kind)) {
      const parts=file.split('/')
      if(parts.length!==4||parts[2]!=='languages'||parts[3]!==`${settings.defaultLocale}.json`)continue
      const target=`${parts.slice(0,3).join('/')}/${code}.json`
      const packageFiles=await context.workspace.listFiles(`${parts[0]}/${parts[1]}/languages`)
      if(!packageFiles.includes(target)) await writeResource(context,backups,target,await context.workspace.readFile(file))
    }
    const strings = JSON.parse((await context.workspace.readFile(`source/i18n/${settings.defaultLocale}.json`)).toString())
    strings.strings = { ...await packageFixedStrings(context,settings.defaultLocale), ...strings.strings }
    await writeResource(context, backups, `source/i18n/${code}.json`, Buffer.from(`${JSON.stringify(strings, null, 2)}\n`))
    const appearance = JSON.parse((await context.workspace.readFile('source/appearance.json')).toString())
    const addLabels = (items: Array<{ label: Record<string,string>; children: unknown[] }>) => { for (const item of items) { item.label[code] = item.label[settings.defaultLocale] ?? ''; addLabels(item.children as typeof items) } }
    for (const menu of Object.values(appearance.menus)) addLabels(menu as Parameters<typeof addLabels>[0])
    await writeResource(context, backups, 'source/appearance.json', Buffer.from(`${JSON.stringify(appearance, null, 2)}\n`))
    settings.locales.push({ code, dir })
    assertValidSchema('site-settings', settings, 'source/site-settings.json')
    const output = Buffer.from(`${JSON.stringify(settings, null, 2)}\n`)
    await writeResource(context, backups, 'source/site-settings.json', output)
    return { created, settings, revision: resourceRevision(output) }
  })
}

export const localeRoutes = new Hono<{Variables: AuthVariables}>()
localeRoutes.post('/drafts/:draftId/locales', requireAuth, async c => {
  try { const body = z.object({ code:z.string().min(2).max(35), dir:z.enum(['ltr','rtl']) }).strict().parse(await c.req.json()); return c.json(await addSiteLocale(await managedResourceContext(c), body.code, body.dir, expectedRevision(c)), 201) }
  catch (error) { return resourceErrorResponse(error,c) }
})
