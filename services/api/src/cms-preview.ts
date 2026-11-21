import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type pg from 'pg'
import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5'
import { lookup } from 'mime-types'
import { buildPreview, loadWorkspace, collectPublicHtmlRoutes } from '@olps/site-builder'
import { resolveContentRef } from '@olps/render'
import type { ContentRef } from '@olps/domain'
import { withDraftLock } from './draft-lock.js'
import { readDraftPluginSecrets } from './site-build-config.js'
import { createCredentialSchema } from './credentials.js'

export async function createCmsPreviewSchema(client: pg.PoolClient): Promise<void> {
  await createCredentialSchema(client)
  await client.query(`CREATE TABLE IF NOT EXISTS cms_preview_capabilities(
    capability_id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,
    return_path TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
}

function tokenHash(value: string): string { return createHash('sha256').update(value).digest('hex') }
function escape(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') }

function managementPath(value: string): string {
  const decoded = decodeURIComponent(value)
  if (!decoded.startsWith('/') || decoded.startsWith('//') || /[\\\u0000-\u001f]/.test(decoded)) throw new Error('PREVIEW_RETURN_PATH_INVALID')
  return value
}

async function safeArtifact(root: string, relative: string): Promise<string> {
  if (relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => part === '..' || part === '.')) throw new Error('PREVIEW_FORBIDDEN')
  const absolute = path.resolve(root, relative)
  if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new Error('PREVIEW_FORBIDDEN')
  let cursor = path.resolve(root)
  for (const part of ['', ...path.relative(root, absolute).split(path.sep)]) {
    cursor = path.join(cursor, part)
    const stat = await fs.lstat(cursor)
    if (stat.isSymbolicLink()) throw new Error('PREVIEW_FORBIDDEN')
  }
  return absolute
}

function injectPreviewHtml(html: string, userName: string, returnPath: string, token: string): string {
  const document = parse(html)
  const walk = (node: DefaultTreeAdapterMap['node']): void => {
    if ('tagName' in node && node.tagName === 'body') {
      const bar = parseFragment(`<aside data-olps-admin-bar style="position:sticky;top:0;z-index:2147483647;padding:12px;background:#17232e;color:white"><a href="${escape(returnPath)}" style="color:white">返回后台</a> · ${escape(userName)}</aside>`).childNodes[0]
      if ('parentNode' in bar) bar.parentNode = node
      node.childNodes.unshift(bar)
    }
    if ('attrs' in node && node.tagName === 'form' && node.attrs.some(attribute => attribute.name === 'data-olps-inquiry-form')) {
      node.attrs.push({ name: 'data-olps-inquiry-endpoint', value: `/api/preview-access/${token}/inquiries` })
    }
    if ('childNodes' in node) for (const child of [...node.childNodes]) walk(child)
  }
  walk(document)
  return serialize(document)
}

export type CmsPreviewOptions = { locale?: string; returnPath?: string; target?: ContentRef }

export class CmsPreviewService {
  constructor(private readonly database: pg.Pool, private readonly sandboxRoot: string, private readonly previewRoot: string, private readonly ttlSeconds = 900) {}

  async create(userId: string, sessionId: string, draftId: string, options: CmsPreviewOptions): Promise<{ previewUrl: string; expiresAt: string }> {
    const returnPath = managementPath(options.returnPath ?? '/pages')
    return withDraftLock(draftId, async () => {
      const authorized = await this.database.query(`SELECT d.* FROM site_drafts d
        JOIN draft_owners o USING(draft_id) JOIN site_owners so ON so.site_id=d.site_id AND so.user_id=o.user_id
        JOIN sessions s ON s.user_id=o.user_id WHERE d.draft_id=$1 AND o.user_id=$2 AND s.session_id=$3 AND s.expires_at>NOW()`, [draftId, userId, sessionId])
      if (!authorized.rowCount) throw new Error('PREVIEW_FORBIDDEN')
      const draft = authorized.rows[0]
      if (draft.init_status !== 'ready') throw new Error('DRAFT_NOT_READY')
      if (!/^[a-f\d-]{36}$/i.test(draft.sandbox_id)) throw new Error('PREVIEW_FORBIDDEN')
      const workspace = path.join(this.sandboxRoot, draft.sandbox_id)
      const loaded = await loadWorkspace(workspace)
      const locale = options.locale ?? loaded.model.settings.defaultLocale
      if (!loaded.model.settings.locales.some(entry => entry.code === locale)) throw new Error('PREVIEW_LOCALE_INVALID')
      const entry = options.target ? '/' + resolveContentRef(loaded.model, options.target, { locale, fromUrl: '/', mode: 'preview' }) : `/${locale}/`
      if (!collectPublicHtmlRoutes(loaded.model, 'preview').some(route => route.url === entry)) throw new Error('PREVIEW_NOT_FOUND')
      const token = randomBytes(32).toString('base64url')
      const capabilityId = randomUUID()
      const directory = path.join(this.previewRoot, capabilityId)
      await buildPreview(workspace, { outputDirectory: directory,pluginSecrets:await readDraftPluginSecrets({draftId,database:this.database}) })
      const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000).toISOString()
      await this.database.query('INSERT INTO cms_preview_capabilities(capability_id,token_hash,session_id,user_id,draft_id,return_path,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [capabilityId, tokenHash(token), sessionId, userId, draftId, returnPath, expiresAt])
      return { previewUrl: `/preview-access/${token}${entry}`, expiresAt }
    })
  }

  async resolve(token: string): Promise<Record<string, unknown>> {
    const result = await this.database.query(`SELECT c.*,u.name AS user_name FROM cms_preview_capabilities c
      JOIN sessions s USING(session_id) JOIN users u ON u.user_id=c.user_id
      JOIN site_drafts d USING(draft_id) JOIN draft_owners o ON o.draft_id=d.draft_id AND o.user_id=c.user_id
      JOIN site_owners so ON so.site_id=d.site_id AND so.user_id=c.user_id
      WHERE c.token_hash=$1 AND c.expires_at>NOW() AND s.expires_at>NOW() AND s.user_id=c.user_id`, [tokenHash(token)])
    if (!result.rowCount) throw new Error('PREVIEW_FORBIDDEN')
    return result.rows[0]
  }

  async read(token: string, subPath: string): Promise<{ content: Buffer; contentType: string }> {
    const capability = await this.resolve(token)
    let relative = decodeURIComponent(subPath).replace(/^\/+/, '')
    if (!relative || relative.endsWith('/')) relative += 'index.html'
    const root = path.join(this.previewRoot, String(capability.capability_id), 'public')
    const file = await safeArtifact(root, relative)
    let content = await fs.readFile(file)
    if (relative.endsWith('.html')) content = Buffer.from(injectPreviewHtml(content.toString('utf8'), String(capability.user_name), String(capability.return_path), token))
    const type = lookup(relative)
    return { content, contentType: type || 'application/octet-stream' }
  }
}
