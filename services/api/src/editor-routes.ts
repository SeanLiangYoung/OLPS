import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { requireAuth, getAuthUser, type AuthVariables } from './auth-middleware.js'
import { resolveSessionFromToken } from './sessions.js'
import { EDITOR_IMAGE_MAX_BYTES, uploadEditorAsset, listEditorAssets, readEditorAssetPreview } from './editor-assets.js'
import { editorSaveSchema, saveEditorPage } from './editor-save.js'
import { listEditorResources, readEditorResource } from './editor-resources.js'

export const editorRoutes = new Hono<{ Variables: AuthVariables }>()

editorRoutes.get('/drafts/:draftId/editor-resources', requireAuth, async c => {
  const session = await resolveSessionFromToken(c.get('accessToken'))
  if (!session) return c.json({ error: '会话无效或已过期' }, 401)
  try { return c.json({ resources: await listEditorResources(getAuthUser(c).userId, session.sessionId, c.req.param('draftId')!) }) }
  catch (error) { return errorResponse(error, c) }
})

editorRoutes.get('/drafts/:draftId/editor-resources/*', async c => {
  const prefix = `/api/drafts/${encodeURIComponent(c.req.param('draftId'))}/editor-resources/`
  try {
    const resource = await readEditorResource(c.req.param('draftId'), c.req.path.slice(prefix.length), c.req.query('token') || '')
    return new Response(new Uint8Array(resource.content), { headers: {
      'Content-Type': resource.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    } })
  } catch (error) { return errorResponse(error, c) }
})

function errorResponse(error: unknown, c: Context) {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'FORBIDDEN') return c.json({ error: '无权访问' }, 403)
  if (message === 'NOT_FOUND' || (error as NodeJS.ErrnoException).code === 'ENOENT') return c.json({ error: '资源不存在' }, 404)
  if (message === 'IMAGE_TOO_LARGE') return c.json({ error: '图片大小不得超过10MiB' }, 413)
  if (message === 'INVALID_IMAGE') return c.json({ error: '图片必须是可以解码的JPEG、PNG、WebP或GIF，像素总量不得超过4000万' }, 400)
  if (message === 'INVALID_ADS') return c.json({ error: '页面类型与广告内容不匹配' }, 400)
  if (message.startsWith('EDITOR_RESOURCE_INVALID:')) return c.json({ error: message.slice('EDITOR_RESOURCE_INVALID:'.length) }, 400)
  if (message === 'PAGE_VERSION_CONFLICT') return c.json({ error: '页面已更新，请重新加载后保存' }, 409)
  if (message === 'PAGE_SLUG_CONFLICT') return c.json({ error: '页面地址已被其他页面使用，请修改后保存' }, 409)
  if (message === 'DRAFT_ORDINARY_EDIT_BLOCKED') return c.json({ error: '草稿正在同步或存在内容冲突，无法编辑' }, 409)
  throw error
}

editorRoutes.get('/drafts/:draftId/assets/:assetId/preview', async c => {
  try {
    const bytes = await readEditorAssetPreview(c.req.param('draftId'), c.req.param('assetId'), c.req.query('token') ?? '')
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } })
  } catch (error) { return errorResponse(error, c) }
})

editorRoutes.post('/drafts/:draftId/assets', requireAuth, bodyLimit({ maxSize: EDITOR_IMAGE_MAX_BYTES + 64 * 1024, onError: c => c.json({ error: '图片大小不得超过10MiB' }, 413) }), async c => {
  const session = await resolveSessionFromToken(c.get('accessToken'))
  if (!session) return c.json({ error: '会话无效或已过期' }, 401)
  const form = await c.req.parseBody()
  if (!(form.file instanceof File)) return c.json({ error: '请选择图片文件' }, 400)
  try {
    const asset = await uploadEditorAsset({ userId: getAuthUser(c).userId, sessionId: session.sessionId, draftId: c.req.param('draftId'), file: form.file })
    return c.json({ asset }, 201)
  } catch (error) { return errorResponse(error, c) }
})

editorRoutes.get('/drafts/:draftId/assets', requireAuth, async c => {
  const session = await resolveSessionFromToken(c.get('accessToken'))
  if (!session) return c.json({ error: '会话无效或已过期' }, 401)
  try { return c.json({ assets: await listEditorAssets(getAuthUser(c).userId, session.sessionId, c.req.param('draftId')!) }) }
  catch (error) { return errorResponse(error, c) }
})

editorRoutes.patch('/drafts/:draftId/pages/:pageId/editor', requireAuth, bodyLimit({ maxSize: 16 * 1024 * 1024 }), async c => {
  const parsed = editorSaveSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: '编辑内容结构无效', issues: parsed.error.issues }, 400)
  try { return c.json(await saveEditorPage(getAuthUser(c).userId, c.req.param('draftId'), c.req.param('pageId'), parsed.data)) }
  catch (error) { return errorResponse(error, c) }
})
