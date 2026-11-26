import { createHash } from 'node:crypto'
import { z } from 'zod'
import { assertValidSchema, type ManagedSiteSettings, type PluginsConfig } from '@olps/domain'
import { completeJson } from './ai-client.js'
import { ContentError, type ContentContext } from './content-sandbox.js'
import { withDraftLock } from './draft-lock.js'
import { assertDraftOrdinaryEditAllowed } from './draft-ordinary-edit-guard.js'
import {
  KnowledgeImportProxyError,
  readKnowledgeTextFileFromService,
  searchKnowledgeOnService,
  type KnowledgeSearchHit,
} from './knowledge-service-client.js'
import { promoteKnowledgeAssetIds } from './promote-knowledge-assets.js'

/** 基本信息提取用的检索词：联系方式、社媒、公司信息 */
export const BASIC_INFO_SEARCH_QUERIES = [
  'WhatsApp',
  'WeChat',
  '联系方式',
  '联系电话',
  '邮箱',
  'Email',
  'Mobile',
  'phone',
  'website',
  'LinkedIn',
  'Facebook',
  'Instagram',
  '地址',
  '公司',
  'sales@',
  'info@',
] as const

const MAX_EXTRACT_DOCUMENTS = 30
const MAX_DOCUMENT_CHARS = 8000
const BINARY_PATH_PATTERN = /\.(png|jpe?g|gif|webp|svg|mp4|webm|pdf|zip)$/i

export function rankWikiPathsFromSearchHits(
  hits: Array<Pick<KnowledgeSearchHit, 'path'> & { query?: string }>,
): string[] {
  const scores = new Map<string, number>()
  for (const hit of hits) {
    const relativePath = hit.path.replace(/\\/g, '/')
    if (!relativePath.startsWith('wiki/') && !relativePath.startsWith('raw/sources/')) continue
    if (BINARY_PATH_PATTERN.test(relativePath)) continue
    scores.set(relativePath, (scores.get(relativePath) ?? 0) + 1)
  }
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([relativePath]) => relativePath)
}

function truncateContent(content: string): string {
  if (content.length <= MAX_DOCUMENT_CHARS) return content
  return `${content.slice(0, MAX_DOCUMENT_CHARS)}\n…`
}

/** 基本资料网址：保留用户填写的 http/https；无协议的主机名补 https://。 */
export function normalizeBasicInfoUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

export function normalizeSocialLinks(
  links: Array<{ platform: string; url: string }>,
): Array<{ platform: string; url: string }> {
  return links
    .map((link) => ({
      platform: link.platform.trim(),
      url: normalizeBasicInfoUrl(link.url),
    }))
    .filter((link) => link.platform && /^https?:\/\//i.test(link.url))
}

const socialLinkSchema = z.object({
  platform: z.string(),
  url: z.string(),
}).strict()

const qrMediaSchema = z.object({
  mediaId: z.string().min(1),
  caption: z.string().optional(),
  path: z.string().optional(),
}).strict()

export const basicInfoSnapshotSchema = z.object({
  siteName: z.string(),
  siteUrl: z.string(),
  company: z.object({
    name: z.string(),
    address: z.string(),
    phone: z.string(),
    email: z.string(),
  }).strict(),
  socialLinks: z.array(socialLinkSchema),
  iconMediaId: z.string().nullable(),
  whatsappPhone: z.string(),
  mapsAddress: z.string(),
  qrMedia: z.array(qrMediaSchema),
}).strict()

export type BasicInfoSnapshot = z.infer<typeof basicInfoSnapshotSchema>

const aiExtractSchema = z.object({
  siteName: z.string().optional().nullable(),
  siteUrl: z.string().optional().nullable(),
  company: z.object({
    name: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
  }).strict().optional().nullable(),
  socialLinks: z.array(socialLinkSchema).optional().nullable(),
  logoAssetId: z.string().optional().nullable(),
  qrAssetIds: z.array(z.string()).optional().nullable(),
  whatsappPhone: z.string().optional().nullable(),
  mapsAddress: z.string().optional().nullable(),
}).strict()

function revisionOf(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function pluginText(value: unknown, locale: string): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const preferred = record[locale]
    if (typeof preferred === 'string') return preferred
    for (const entry of Object.values(record)) {
      if (typeof entry === 'string' && entry.trim()) return entry
    }
  }
  return ''
}

function setPluginText(current: unknown, locale: string, next: string): unknown {
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return { ...(current as Record<string, unknown>), [locale]: next }
  }
  return next
}

function pickFilled(current: string, candidate: string | null | undefined): string {
  if (typeof candidate !== 'string') return current
  const trimmed = candidate.trim()
  return trimmed ? trimmed : current
}

export function readBasicInfoSnapshot(
  settings: ManagedSiteSettings,
  plugins: PluginsConfig,
  locale: string,
  qrMedia: BasicInfoSnapshot['qrMedia'] = [],
): BasicInfoSnapshot {
  const whatsapp = plugins.plugins.whatsapp?.settings ?? {}
  const maps = plugins.plugins['google-maps']?.settings ?? {}
  return {
    siteName: settings.siteName,
    siteUrl: settings.siteUrl,
    company: {
      name: settings.company.name,
      address: settings.company.address,
      phone: settings.company.phone,
      email: settings.company.email,
    },
    socialLinks: settings.socialLinks.map((link) => ({ platform: link.platform, url: link.url })),
    iconMediaId: settings.iconMediaId,
    whatsappPhone: typeof whatsapp.phone === 'string' ? whatsapp.phone : '',
    mapsAddress: pluginText(maps.defaultAddress, locale),
    qrMedia: qrMedia.map((item) => ({ ...item })),
  }
}

export function mergeExtractedBasicInfo(input: {
  before: BasicInfoSnapshot
  extracted: z.infer<typeof aiExtractSchema>
  logoMediaId: string | null
  qrMedia: BasicInfoSnapshot['qrMedia']
}): BasicInfoSnapshot {
  const { before, extracted, logoMediaId, qrMedia } = input
  const company = extracted.company ?? {}
  const extractedSocial = extracted.socialLinks
    ? normalizeSocialLinks(extracted.socialLinks)
    : []
  const siteUrlCandidate =
    typeof extracted.siteUrl === 'string' ? normalizeBasicInfoUrl(extracted.siteUrl) : ''
  return {
    siteName: pickFilled(before.siteName, extracted.siteName),
    siteUrl: pickFilled(before.siteUrl, siteUrlCandidate || null),
    company: {
      name: pickFilled(before.company.name, company.name),
      address: pickFilled(before.company.address, company.address),
      phone: pickFilled(before.company.phone, company.phone),
      email: pickFilled(before.company.email, company.email),
    },
    socialLinks: extractedSocial.length
      ? extractedSocial
      : normalizeSocialLinks(before.socialLinks.map((link) => ({ ...link }))),
    iconMediaId: logoMediaId ?? before.iconMediaId,
    whatsappPhone: pickFilled(before.whatsappPhone, extracted.whatsappPhone ?? company.phone),
    mapsAddress: pickFilled(before.mapsAddress, extracted.mapsAddress ?? company.address),
    qrMedia: qrMedia.length ? qrMedia : before.qrMedia.map((item) => ({ ...item })),
  }
}

async function loadSettingsAndPlugins(context: ContentContext): Promise<{
  settings: ManagedSiteSettings
  settingsBytes: Buffer
  settingsRevision: string
  plugins: PluginsConfig
  pluginsBytes: Buffer
  pluginsRevision: string
}> {
  const settingsBytes = await context.workspace.readFile('source/site-settings.json')
  const pluginsBytes = await context.workspace.readFile('source/plugins.json')
  const settings = JSON.parse(settingsBytes.toString('utf8')) as ManagedSiteSettings
  const plugins = JSON.parse(pluginsBytes.toString('utf8')) as PluginsConfig
  assertValidSchema('site-settings', settings, 'source/site-settings.json')
  assertValidSchema('plugins', plugins, 'source/plugins.json')
  return {
    settings,
    settingsBytes,
    settingsRevision: revisionOf(settingsBytes),
    plugins,
    pluginsBytes,
    pluginsRevision: revisionOf(pluginsBytes),
  }
}

async function resolveSiteId(context: ContentContext): Promise<string> {
  const result = await context.database.query('SELECT site_id FROM site_drafts WHERE draft_id=$1', [context.draftId])
  if (!result.rowCount || !result.rows[0].site_id) throw new ContentError('NOT_FOUND')
  return String(result.rows[0].site_id)
}

async function loadDocumentsByIds(
  context: ContentContext,
  siteId: string,
  knowledgeDocumentIds: string[],
): Promise<Array<{ documentId: string; title: string; content: string; wikiPath?: string }>> {
  const kb = await context.database.query('SELECT kb_id FROM knowledge_bases WHERE site_id=$1', [siteId])
  if (!kb.rowCount) throw new ContentError('NOT_FOUND', { field: 'knowledgeBase' })
  const kbId = kb.rows[0].kb_id as string
  const rows = await context.database.query(
    `SELECT doc_id, title, content, wiki_path FROM knowledge_documents
     WHERE kb_id=$1 AND doc_id = ANY($2::uuid[])
     ORDER BY updated_at DESC NULLS LAST, created_at DESC`,
    [kbId, knowledgeDocumentIds],
  )
  if (rows.rowCount !== knowledgeDocumentIds.length) {
    throw new ContentError('FORBIDDEN', { field: 'knowledgeDocumentIds' })
  }
  return rows.rows.map((row) => ({
    documentId: String(row.doc_id),
    title: String(row.title ?? ''),
    content: truncateContent(String(row.content ?? '')),
    wikiPath: typeof row.wiki_path === 'string' ? row.wiki_path : undefined,
  }))
}

async function loadDocumentsByWikiPaths(
  context: ContentContext,
  siteId: string,
  wikiPaths: string[],
): Promise<Array<{ documentId: string; title: string; content: string; wikiPath: string }>> {
  if (!wikiPaths.length) return []
  const kb = await context.database.query('SELECT kb_id FROM knowledge_bases WHERE site_id=$1', [siteId])
  if (!kb.rowCount) throw new ContentError('NOT_FOUND', { field: 'knowledgeBase' })
  const kbId = kb.rows[0].kb_id as string
  const rows = await context.database.query(
    `SELECT DISTINCT ON (wiki_path) doc_id, title, content, wiki_path
     FROM knowledge_documents
     WHERE kb_id=$1 AND wiki_path = ANY($2::text[])
     ORDER BY wiki_path, updated_at DESC NULLS LAST, created_at DESC`,
    [kbId, wikiPaths],
  )
  const byPath = new Map(
    rows.rows.map((row) => [
      String(row.wiki_path),
      {
        documentId: String(row.doc_id),
        title: String(row.title ?? ''),
        content: truncateContent(String(row.content ?? '')),
        wikiPath: String(row.wiki_path),
      },
    ]),
  )
  const ordered: Array<{ documentId: string; title: string; content: string; wikiPath: string }> = []
  for (const wikiPath of wikiPaths) {
    const existing = byPath.get(wikiPath)
    if (existing) {
      ordered.push(existing)
      continue
    }
    try {
      const content = await readKnowledgeTextFileFromService(siteId, wikiPath)
      if (!content?.trim()) continue
      ordered.push({
        documentId: wikiPath,
        title: wikiPath.split('/').pop() || wikiPath,
        content: truncateContent(content),
        wikiPath,
      })
    } catch (error) {
      if (error instanceof KnowledgeImportProxyError && error.status === 404) continue
      throw error
    }
  }
  return ordered
}

async function loadOverviewDocument(
  siteId: string,
): Promise<{ documentId: string; title: string; content: string; wikiPath: string } | null> {
  try {
    const content = await readKnowledgeTextFileFromService(siteId, 'wiki/overview.md')
    if (!content?.trim() || content.trim() === '# Overview') return null
    return {
      documentId: 'wiki/overview.md',
      title: 'Overview',
      content: truncateContent(content),
      wikiPath: 'wiki/overview.md',
    }
  } catch (error) {
    if (error instanceof KnowledgeImportProxyError && (error.status === 404 || error.status === 503)) {
      return null
    }
    throw error
  }
}

async function searchBasicInfoHits(siteId: string): Promise<Array<KnowledgeSearchHit & { query: string }>> {
  const settled = await Promise.all(
    BASIC_INFO_SEARCH_QUERIES.map(async (query) => {
      try {
        const hits = await searchKnowledgeOnService(siteId, { query })
        return hits.map((hit) => ({ ...hit, query }))
      } catch (error) {
        if (error instanceof KnowledgeImportProxyError && error.status === 503) throw error
        return [] as Array<KnowledgeSearchHit & { query: string }>
      }
    }),
  )
  return settled.flat()
}

async function loadKnowledgeDocuments(
  context: ContentContext,
  siteId: string,
  knowledgeDocumentIds: string[] | undefined,
): Promise<Array<{ documentId: string; title: string; content: string; wikiPath?: string }>> {
  if (knowledgeDocumentIds?.length) {
    return loadDocumentsByIds(context, siteId, knowledgeDocumentIds)
  }

  const overview = await loadOverviewDocument(siteId)
  const searchHits = await searchBasicInfoHits(siteId)
  const rankedPaths = rankWikiPathsFromSearchHits(searchHits).slice(0, MAX_EXTRACT_DOCUMENTS)
  const searched = await loadDocumentsByWikiPaths(context, siteId, rankedPaths)

  const documents: Array<{ documentId: string; title: string; content: string; wikiPath?: string }> = []
  const seen = new Set<string>()
  if (overview) {
    documents.push(overview)
    seen.add(overview.wikiPath)
  }
  for (const document of searched) {
    if (seen.has(document.wikiPath)) continue
    seen.add(document.wikiPath)
    documents.push(document)
    if (documents.length >= MAX_EXTRACT_DOCUMENTS) break
  }
  return documents
}

async function loadRoleAssets(
  context: ContentContext,
  siteId: string,
  roles: string[],
): Promise<Array<{ assetId: string; role: string; caption: string; sourcePath: string }>> {
  const rows = await context.database.query(
    `SELECT a.asset_id, a.role, a.caption, a.source_path
     FROM knowledge_assets a
     JOIN knowledge_bases k USING (kb_id)
     WHERE k.site_id=$1 AND a.role = ANY($2::text[])
     ORDER BY a.updated_at DESC NULLS LAST, a.created_at DESC`,
    [siteId, roles],
  )
  return rows.rows.map((row) => ({
    assetId: String(row.asset_id),
    role: String(row.role),
    caption: typeof row.caption === 'string' ? row.caption : '',
    sourcePath: String(row.source_path ?? ''),
  }))
}

async function mediaPathFor(context: ContentContext, mediaId: string): Promise<string | undefined> {
  try {
    const bytes = await context.workspace.readFile(`source/media/${mediaId}.json`)
    const media = JSON.parse(bytes.toString('utf8')) as { path?: string }
    return typeof media.path === 'string' ? media.path : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function extractBasicInfo(
  context: ContentContext,
  input: { locale: string; knowledgeDocumentIds?: string[] },
): Promise<{
  before: BasicInfoSnapshot
  after: BasicInfoSnapshot
  revisions: { settings: string; plugins: string }
}> {
  const siteId = await resolveSiteId(context)
  const loaded = await loadSettingsAndPlugins(context)
  const before = readBasicInfoSnapshot(loaded.settings, loaded.plugins, input.locale)
  const documents = await loadKnowledgeDocuments(context, siteId, input.knowledgeDocumentIds)
  const roleAssets = await loadRoleAssets(context, siteId, ['logo', 'qr_code'])
  const logoAssets = roleAssets.filter((asset) => asset.role === 'logo')
  const qrAssets = roleAssets.filter((asset) => asset.role === 'qr_code')

  const extractedRaw = await completeJson({
    system:
      '你是企业网站资料提取助手。只根据提供的知识库内容抽取已确认的基本信息，禁止编造。返回严格 JSON：siteName、siteUrl、company{name,address,phone,email}、socialLinks[{platform,url}]、logoAssetId、qrAssetIds、whatsappPhone、mapsAddress。抽不到的字段用 null 或空数组。logoAssetId / qrAssetIds 只能使用素材清单中的 assetId。',
    user: JSON.stringify({
      locale: input.locale,
      current: before,
      documents,
      assets: roleAssets,
    }),
  })
  const extracted = aiExtractSchema.parse(extractedRaw)

  const promoteIds = new Set<string>()
  const preferredLogo =
    (extracted.logoAssetId && logoAssets.some((asset) => asset.assetId === extracted.logoAssetId)
      ? extracted.logoAssetId
      : null) ?? logoAssets[0]?.assetId ?? null
  if (preferredLogo) promoteIds.add(preferredLogo)

  const preferredQrIds = (extracted.qrAssetIds ?? [])
    .filter((assetId) => qrAssets.some((asset) => asset.assetId === assetId))
  const qrIds = preferredQrIds.length ? preferredQrIds : qrAssets.map((asset) => asset.assetId)
  for (const assetId of qrIds) promoteIds.add(assetId)

  const promoted = await promoteKnowledgeAssetIds(context, siteId, promoteIds)
  const logoMediaId = preferredLogo ? promoted.get(preferredLogo) ?? null : null
  const qrMedia: BasicInfoSnapshot['qrMedia'] = []
  for (const assetId of qrIds) {
    const mediaId = promoted.get(assetId)
    if (!mediaId) continue
    const asset = qrAssets.find((item) => item.assetId === assetId)
    qrMedia.push({
      mediaId,
      caption: asset?.caption || asset?.sourcePath || undefined,
      path: await mediaPathFor(context, mediaId),
    })
  }

  const after = mergeExtractedBasicInfo({
    before,
    extracted,
    logoMediaId,
    qrMedia,
  })

  return {
    before,
    after,
    revisions: {
      settings: loaded.settingsRevision,
      plugins: loaded.pluginsRevision,
    },
  }
}

export async function applyBasicInfo(
  context: ContentContext,
  input: {
    locale: string
    after: BasicInfoSnapshot
    revisions: { settings: string; plugins: string }
  },
): Promise<{ revisions: { settings: string; plugins: string } }> {
  const parsed = basicInfoSnapshotSchema.parse(input.after)
  const after: BasicInfoSnapshot = {
    ...parsed,
    siteUrl: normalizeBasicInfoUrl(parsed.siteUrl),
    socialLinks: normalizeSocialLinks(parsed.socialLinks),
  }
  return withDraftLock(context.draftId, async () => {
    const client = await context.database.connect()
    let settingsBefore: Buffer | undefined
    let pluginsBefore: Buffer | undefined
    let settingsWritten = false
    let pluginsWritten = false
    try {
      await client.query('BEGIN')
      const access = await client.query(
        'SELECT d.* FROM site_drafts d JOIN draft_owners o USING(draft_id) WHERE d.draft_id=$1 AND o.user_id=$2 FOR UPDATE OF d',
        [context.draftId, context.userId],
      )
      if (!access.rowCount) throw new ContentError('FORBIDDEN')
      assertDraftOrdinaryEditAllowed(access.rows[0])

      settingsBefore = await context.workspace.readFile('source/site-settings.json')
      pluginsBefore = await context.workspace.readFile('source/plugins.json')
      if (revisionOf(settingsBefore) !== input.revisions.settings) throw new ContentError('REVISION_CONFLICT')
      if (revisionOf(pluginsBefore) !== input.revisions.plugins) throw new ContentError('REVISION_CONFLICT')

      const settings = JSON.parse(settingsBefore.toString('utf8')) as ManagedSiteSettings
      const plugins = JSON.parse(pluginsBefore.toString('utf8')) as PluginsConfig
      assertValidSchema('site-settings', settings, 'source/site-settings.json')
      assertValidSchema('plugins', plugins, 'source/plugins.json')

      settings.siteName = after.siteName
      settings.siteUrl = after.siteUrl
      settings.company = {
        name: after.company.name,
        address: after.company.address,
        phone: after.company.phone,
        email: after.company.email,
      }
      settings.socialLinks = after.socialLinks.map((link) => ({ platform: link.platform, url: link.url }))
      settings.iconMediaId = after.iconMediaId
      assertValidSchema('site-settings', settings, 'source/site-settings.json')

      if (!plugins.plugins.whatsapp) {
        plugins.plugins.whatsapp = {
          enabled: true,
          permissionsAcceptedAt: null,
          permissionsAcceptedBy: null,
          settings: {},
        }
      }
      if (!plugins.plugins['google-maps']) {
        plugins.plugins['google-maps'] = {
          enabled: true,
          permissionsAcceptedAt: null,
          permissionsAcceptedBy: null,
          settings: {},
        }
      }
      plugins.plugins.whatsapp.settings = {
        ...plugins.plugins.whatsapp.settings,
        phone: after.whatsappPhone,
      }
      plugins.plugins['google-maps'].settings = {
        ...plugins.plugins['google-maps'].settings,
        defaultAddress: setPluginText(
          plugins.plugins['google-maps'].settings.defaultAddress,
          input.locale,
          after.mapsAddress,
        ),
      }
      assertValidSchema('plugins', plugins, 'source/plugins.json')

      const nextSettings = Buffer.from(`${JSON.stringify(settings, null, 2)}\n`)
      const nextPlugins = Buffer.from(`${JSON.stringify(plugins, null, 2)}\n`)
      await context.workspace.writeFile('source/site-settings.json', nextSettings)
      settingsWritten = true
      await context.workspace.writeFile('source/plugins.json', nextPlugins)
      pluginsWritten = true
      await client.query("UPDATE site_drafts SET sync_status='dirty',updated_at=NOW() WHERE draft_id=$1", [context.draftId])
      await client.query('COMMIT')
      return {
        revisions: {
          settings: revisionOf(nextSettings),
          plugins: revisionOf(nextPlugins),
        },
      }
    } catch (error) {
      await client.query('ROLLBACK')
      if (settingsWritten && settingsBefore) await context.workspace.writeFile('source/site-settings.json', settingsBefore)
      if (pluginsWritten && pluginsBefore) await context.workspace.writeFile('source/plugins.json', pluginsBefore)
      throw error
    } finally {
      client.release()
    }
  })
}
