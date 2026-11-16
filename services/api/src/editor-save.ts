import { z } from 'zod'
import { validateGuideGraph, type PageBody } from '@olps/domain'
import { withDraftLock } from './draft-lock.js'
import { pool } from './db.js'
import { openEditorWorkspace } from './editor-assets.js'
import { readPageFromWorkspace, writePageToWorkspace, pageRecordFromJson } from './page-sandbox.js'
import { readSiteSettingsFromWorkspace } from './workspace-factory.js'
import { pageJsonPath } from '@olps/sync'
import { collectPageReferences } from './selected-publication-resources.js'

const optionSchema = z.object({ id: z.string().min(1), label: z.string(), action: z.enum(['navigate', 'go_cta', 'link_page']), targetScreenId: z.string().optional(), pageId: z.string().optional() }).passthrough()
const adsSchema = z.object({
  keywordCluster: z.array(z.string()),
  screens: z.array(z.object({ screenId: z.string().min(1), role: z.enum(['entry', 'content', 'cta']), title: z.string(), html: z.string(), entryFor: z.array(z.string()).optional() }).passthrough()),
  guide: z.object({ entryByKeyword: z.record(z.string(), z.string()), nodes: z.record(z.string(), z.object({ options: z.array(optionSchema) }).passthrough()) }).passthrough(),
}).passthrough()
export const editorSaveSchema = z.object({
  body: z.object({ html: z.string(), blocks: z.array(z.unknown()).optional(), ads: adsSchema.optional() }).passthrough(),
  expectedUpdatedAt: z.iso.datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  title: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).refine(value => !value.includes('..') && !/[\\?#\u0000]/.test(value) && !value.startsWith('/'), '页面地址无效').optional(),
  locale: z.string().trim().min(1).optional(),
  translationGroupId: z.string().trim().min(1).nullable().optional(),
  seo: z.object({ title: z.string(), description: z.string(), canonical: z.string().optional(), image: z.string().optional(), robots: z.enum(['index,follow', 'noindex,nofollow']).optional() }).passthrough().optional(),
}).strict()

export async function saveEditorPage(userId: string, draftId: string, pageId: string, input: z.infer<typeof editorSaveSchema>) {
  return withDraftLock(draftId, async () => {
    const { workspace, row: draftRow } = await openEditorWorkspace(userId, draftId, true)
    const result = await pool.query('SELECT * FROM pages WHERE draft_id=$1 AND page_id=$2', [draftId, pageId])
    if (!result.rowCount) throw new Error('NOT_FOUND')
    const row = result.rows[0]!
    if (new Date(row.updated_at as string).toISOString() !== input.expectedUpdatedAt) throw new Error('PAGE_VERSION_CONFLICT')
    const json = await readPageFromWorkspace(workspace, pageId)
    if (!json) throw new Error('NOT_FOUND')
    const originalFile = await workspace.readFile(pageJsonPath(pageId))
    if (input.slug) {
      const duplicate = await pool.query('SELECT 1 FROM pages WHERE draft_id=$1 AND LOWER(slug)=LOWER($2) AND page_id<>$3', [draftId, input.slug, pageId])
      if (duplicate.rowCount) throw new Error('PAGE_SLUG_CONFLICT')
    }
    if (input.body.ads && json.kind !== 'ads') throw new Error('INVALID_ADS')
    const settings = await readSiteSettingsFromWorkspace(workspace)
    const body = input.body as PageBody
    const issues = body.ads ? validateGuideGraph(body.ads, { screenCap: settings.screenCap }).issues : []
    if (body.ads) {
      const pages = await pool.query('SELECT page_id FROM pages WHERE draft_id=$1', [draftId])
      const pageIds = new Set(pages.rows.map(page => String(page.page_id)))
      for (const [screenId, node] of Object.entries(body.ads.guide.nodes)) {
        for (const option of node.options) {
          if (option.action === 'link_page' && (!option.pageId || !pageIds.has(option.pageId))) {
            issues.push({ code: 'guide_page_missing', message: 'Guide目标页面不存在', screenId, optionId: option.id })
          }
        }
      }
    }
    const now = new Date(Math.max(Date.now(), new Date(row.updated_at as string).getTime() + 1)).toISOString()
    const next = {
      ...json, body, title: input.title ?? json.title, slug: input.slug ?? json.slug,
      locale: input.locale ?? json.locale, seo: input.seo ?? json.seo,
      translationGroupId: 'translationGroupId' in input ? input.translationGroupId ?? undefined : json.translationGroupId,
      metadata: { ...json.metadata, ...input.metadata }, updatedAt: now,
      status: json.status === 'unpublished' ? 'unpublished' as const : 'draft' as const,
    }
    let references: ReturnType<typeof collectPageReferences>
    try { references = collectPageReferences(next) }
    catch (error) { throw new Error(`EDITOR_RESOURCE_INVALID:${error instanceof Error ? error.message : String(error)}`) }
    for (const reference of references) {
      if (reference.kind !== 'asset') continue
      const value = reference.url.trim()
      const normalized = value.startsWith('assets/') || value.startsWith('./assets/') ? `/${value.replace(/^\.\//, '')}` : value
      let url: URL
      let decoded: string
      try { url = new URL(normalized, 'https://editor.invalid/'); decoded = decodeURIComponent(normalized) }
      catch { throw new Error(`EDITOR_RESOURCE_INVALID:${reference.path}`) }
      if (url.origin !== 'https://editor.invalid' || !url.pathname.startsWith('/assets/')) {
        if (decoded.startsWith('/assets/') && decoded.includes('..')) throw new Error(`EDITOR_RESOURCE_INVALID:${reference.path}`)
        continue
      }
      const relative = decodeURIComponent(url.pathname).slice(1)
      if (relative.includes('\\') || relative.includes('\0') || decoded.split('/').includes('..')) throw new Error(`EDITOR_RESOURCE_INVALID:${reference.path}`)
      try { await workspace.readFile(relative) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`EDITOR_RESOURCE_INVALID:本地资源不存在：${reference.url}`)
        throw error
      }
    }
    const client = await pool.connect()
    let fileChanged = false
    try {
      await client.query('BEGIN')
      const updated = await client.query('UPDATE pages SET body=$1::jsonb, metadata=$2::jsonb, updated_at=$3, status=$4, title=$7, slug=$8, locale=$9, seo=$10::jsonb WHERE draft_id=$5 AND page_id=$6 AND updated_at=$11::timestamptz RETURNING page_id', [JSON.stringify(body), JSON.stringify({ ...next.metadata, translationGroupId: next.translationGroupId }), now, next.status, draftId, pageId, next.title, next.slug, next.locale, JSON.stringify(next.seo), input.expectedUpdatedAt])
      if (!updated.rowCount) throw new Error('PAGE_VERSION_CONFLICT')
      fileChanged = true
      await writePageToWorkspace(workspace, next)
      await client.query(`UPDATE site_drafts SET sync_status='dirty',head_commit_id=$2,updated_at=NOW() WHERE draft_id=$1`, [draftId, workspace.getState().headCommitId])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      if (fileChanged) await workspace.writeFile(pageJsonPath(pageId), originalFile)
      if ((error as NodeJS.ErrnoException).code === '23505') throw new Error('PAGE_SLUG_CONFLICT')
      throw error
    } finally { client.release() }
    return { page: pageRecordFromJson(draftId, draftRow.site_id ? String(draftRow.site_id) : null, next, { createdAt: new Date(row.created_at as string).toISOString(), updatedAt: now }), issues }
  })
}
