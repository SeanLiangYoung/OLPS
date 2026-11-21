import fs from 'node:fs/promises'
import path from 'node:path'
import type { Context } from 'hono'
import { getAuthUser } from './auth-middleware.js'
import { pool } from './db.js'
import { fetchDraftRow, openDraftWorkspaceFromRow } from './draft-preview-support.js'
import { ContentError, type ContentContext } from './content-sandbox.js'

export async function managedResourceContext(c: Context): Promise<ContentContext> {
  const userId = getAuthUser(c).userId
  const draftId = c.req.param('draftId')!
  const access = await pool.query('SELECT 1 FROM draft_owners WHERE draft_id=$1 AND user_id=$2', [draftId, userId])
  if (!access.rowCount) throw new ContentError('FORBIDDEN')
  return { userId, draftId, database: pool, workspace: await openDraftWorkspaceFromRow(await fetchDraftRow(draftId)) }
}

export function resourceId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(value)) throw new ContentError('VALIDATION_FAILED', { field: 'id' })
  return value
}

export { resourceRevision } from './resource-revision.js'

export function expectedRevision(c: Context): string {
  const header = c.req.header('If-Match')
  if (!header || !/^"sha256:[a-f0-9]{64}"$/.test(header)) throw new ContentError('VALIDATION_FAILED', { field: 'If-Match' })
  return header.slice(1, -1)
}

export async function readResource(context: ContentContext, file: string): Promise<Buffer | null> {
  try { return await context.workspace.readFile(file) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function writeResource(context: ContentContext, backups: Map<string, Buffer | null>, file: string, bytes: Buffer | null): Promise<void> {
  if (!backups.has(file)) backups.set(file, await readResource(context, file))
  if (bytes === null) { await fs.rm(path.join(context.workspace.getState().workspacePath, file), { force: true }); return }
  await fs.mkdir(path.dirname(path.join(context.workspace.getState().workspacePath, file)), { recursive: true })
  await context.workspace.writeFile(file, bytes)
}

export function resourceErrorResponse(error: unknown, c: Context): Response {
  if(error && typeof error==='object' && 'code' in error && error.code==='ENOENT')return c.json({error:'资源不存在',code:'NOT_FOUND'},404)
  if (error instanceof ContentError) {
    const status = error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : ['VALIDATION_FAILED','REVISION_REQUIRED'].includes(error.code) ? 400 : 409
    const messages:Record<string,string>={FORBIDDEN:'没有执行此操作的权限',NOT_FOUND:'内容或资源不存在',VALIDATION_FAILED:'填写内容不符合要求，请检查后重试',RESOURCE_IN_USE:'其他内容仍在使用这个资源',REVISION_CONFLICT:'其他成员已经修改了内容，请重新加载后核对',REVISION_REQUIRED:'请重新加载内容后保存',NOT_CONNECTED:'请先完成营销平台授权',PERMISSIONS_REQUIRED:'请确认插件需要的权限',THEME_CHANGE_REQUIRES_CONFIRMATION:'请确认当前内容受到的主题变更影响'}
    return c.json({ error:typeof error.details.reason==='string'?error.details.reason:messages[error.code]??'当前操作无法完成，请检查设置后重试', code: error.code, details: error.details }, status)
  }
  if (error instanceof Error && ['SchemaValidationError', 'ZodError'].includes(error.name)) return c.json({ error: '文件结构无效', code: 'VALIDATION_FAILED' }, 400)
  if (error instanceof SyntaxError || error instanceof URIError) return c.json({ error: '请求格式无效', code: 'VALIDATION_FAILED' }, 400)
  if (error instanceof Error && error.message === 'DRAFT_ORDINARY_EDIT_BLOCKED') return c.json({ error: '草稿正在同步或存在内容冲突', code: 'DRAFT_BUSY' }, 409)
  throw error
}

export function resourceLimit(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (raw === undefined) return defaultValue
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`)
  return value
}

export async function resourceUsages(context: ContentContext, match: (record: Record<string, unknown>) => boolean, skip: string[] = []): Promise<Array<{ path: string; field: string }>> {
  const usages: Array<{ path: string; field: string }> = []
  function visit(value: unknown, file: string, field: string): void {
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, file, `${field}[${index}]`)); return }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (match(record)) usages.push({ path: file, field })
    for (const [key, nested] of Object.entries(record)) visit(nested, file, field ? `${field}.${key}` : key)
  }
  for (const file of await context.workspace.listFiles('source')) {
    if (skip.includes(file) || !file.endsWith('.json')) continue
    visit(JSON.parse((await context.workspace.readFile(file)).toString('utf8')), file, '')
  }
  return usages
}
