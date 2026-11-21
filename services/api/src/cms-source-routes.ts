import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import type pg from 'pg'
import { Hono } from 'hono'
import { lookup } from 'mime-types'
import { pool } from './db.js'
import { appConfig } from './config.js'
import { requireAuth, getAuthUser, type AuthVariables } from './auth-middleware.js'
import { resolveSessionFromToken } from './sessions.js'
import { managedResourceContext, resourceErrorResponse } from './managed-resource-context.js'
import { rewriteCmsResourceCss } from './cms-resource-css.js'

export async function createCmsResourceSchema(client: pg.PoolClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS cms_resource_capabilities(token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL)`)
}

export const cmsSourceRoutes = new Hono<{ Variables: AuthVariables }>()

cmsSourceRoutes.get('/drafts/:draftId/source', requireAuth, async c => {
  try {
    const context = await managedResourceContext(c)
    const relative = c.req.query('path') ?? ''
    if (relative === '' && c.req.query('list') === '1') return c.json({ entries: ['source', 'themes', 'plugins'] })
    if (!/^(source|themes|plugins)(?:\/|$)/.test(relative) || relative.split('/').some(part => part === '..' || part === '.' || part.startsWith('.'))) return c.json({ error: '资源地址无效' }, 400)
    if (c.req.query('list') === '1') {
      const prefix = relative.replace(/\/$/, '') + '/'
      const files = await context.workspace.listFiles(relative)
      return c.json({ entries: [...new Set(files.map(file => file.slice(prefix.length).split('/')[0]).filter(Boolean))].sort() })
    }
    if (!/\.(json|liquid|css)$/.test(relative)) return c.json({ error: '资源类型不允许读取' }, 403)
    return c.json({ text: (await context.workspace.readFile(relative)).toString('utf8') })
  } catch (error) { return resourceErrorResponse(error, c) }
})

cmsSourceRoutes.post('/drafts/:draftId/resource-access', requireAuth, async c => {
  try {
  await managedResourceContext(c)
  const session = await resolveSessionFromToken(c.get('accessToken'))
  if (!session) return c.json({ error: '会话已失效' }, 403)
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + appConfig.editorResourceTtlSeconds * 1000).toISOString()
  await pool.query('INSERT INTO cms_resource_capabilities(token_hash,user_id,session_id,draft_id,expires_at) VALUES($1,$2,$3,$4,$5)', [createHash('sha256').update(token).digest('hex'), getAuthUser(c).userId, session.sessionId, c.req.param('draftId'), expiresAt])
  return c.json({ token, expiresAt, resourceBaseUrl: `/api/drafts/${c.req.param('draftId')}/resources/` })
  } catch(error) { return resourceErrorResponse(error,c) }
})

cmsSourceRoutes.get('/drafts/:draftId/resources/*', async c => {
  const token = c.req.query('token')
  if (!token) return c.text('访问权限已失效', 403)
  const access = await pool.query(`SELECT d.sandbox_id FROM cms_resource_capabilities r JOIN sessions s USING(session_id)
    JOIN site_drafts d USING(draft_id) JOIN draft_owners o ON o.draft_id=d.draft_id AND o.user_id=r.user_id
    JOIN site_owners so ON so.site_id=d.site_id AND so.user_id=r.user_id
    WHERE r.token_hash=$1 AND r.draft_id=$2 AND r.expires_at>NOW() AND s.expires_at>NOW() AND s.user_id=r.user_id`, [createHash('sha256').update(token).digest('hex'), c.req.param('draftId')])
  if (!access.rowCount) return c.text('访问权限已失效', 403)
  const prefix = `/api/drafts/${c.req.param('draftId')}/resources/`
  const relative = decodeURIComponent(c.req.path.slice(prefix.length))
  if (!/^(?:assets\/uploads\/|themes\/[^/]+\/assets\/|plugins\/[^/]+\/assets\/)/.test(relative) || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => part === '..' || part === '.')) return c.text('资源地址无效', 403)
  const sandboxId = String(access.rows[0].sandbox_id)
  if (!/^[a-f\d-]{36}$/i.test(sandboxId)) return c.text('资源地址无效', 403)
  const root = path.resolve(appConfig.sandboxRoot, sandboxId)
  let cursor = root
  try {
    for (const part of ['', ...relative.split('/')]) {
      cursor = path.join(cursor, part)
      if ((await fs.lstat(cursor)).isSymbolicLink()) return c.text('资源地址无效', 403)
    }
    let bytes = await fs.readFile(cursor)
    if(relative.endsWith('.css'))bytes=Buffer.from(rewriteCmsResourceCss(bytes.toString('utf8'),relative,prefix,token))
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': lookup(relative) || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" } })
  } catch (error) {
    if(error instanceof Error && error.message==='RESOURCE_PATH_FORBIDDEN')return c.text('资源地址无效',403)
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return c.text('资源不存在', 404)
    throw error
  }
})
