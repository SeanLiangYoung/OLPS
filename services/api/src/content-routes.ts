import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { requireAuth, getAuthUser, type AuthVariables } from './auth-middleware.js'
import { pool } from './db.js'
import { fetchDraftRow, openDraftWorkspaceFromRow } from './draft-preview-support.js'
import { ContentError, createContent, deleteContent, readContent, saveContent, listContent, reorderContent, type ContentContext } from './content-sandbox.js'
import { resourceErrorResponse } from './managed-resource-context.js'

const kindSchema = z.enum(['page','collection','group','item'])
const contentSchema = z.object({ref:kindSchema,meta:z.record(z.string(),z.unknown()),locale:z.record(z.string(),z.unknown()),collectionId:z.string().optional()}).strict()
export const contentRoutes = new Hono<{Variables:AuthVariables}>()
contentRoutes.use('/drafts/:draftId/content/*',requireAuth)

async function contextFor(c: Context): Promise<ContentContext> {
  const userId = getAuthUser(c).userId
  const draftId = c.req.param('draftId')!
  if (!(await pool.query('SELECT 1 FROM draft_owners WHERE draft_id=$1 AND user_id=$2',[draftId,userId])).rowCount) throw new ContentError('FORBIDDEN')
  return {userId,draftId,database:pool,workspace:await openDraftWorkspaceFromRow(await fetchDraftRow(draftId))}
}

function requestRevision(c: Context): string {
  const value = c.req.header('If-Match')
  if (!value || !/^"sha256:[a-f0-9]{64}"$/.test(value)) throw new ContentError('VALIDATION_FAILED',{field:'If-Match'})
  return value.slice(1,-1)
}

function errorResponse(error: unknown,c: Context): Response {
  if (error && typeof error==='object' && 'code' in error && error.code==='23505') return c.json({error:'内容地址或标识已被使用',code:'RESOURCE_IN_USE'},409)
  if (error && typeof error==='object' && 'code' in error && error.code==='ENOENT') return c.json({error:'内容不存在',code:'NOT_FOUND'},404)
  if (error instanceof z.ZodError || (error instanceof Error && error.name === 'SchemaValidationError')) return c.json({error:'内容结构无效',code:'VALIDATION_FAILED'},400)
  if (error instanceof ContentError) {
    return resourceErrorResponse(error,c)
  }
  if (error instanceof Error && error.message === 'DRAFT_ORDINARY_EDIT_BLOCKED') return c.json({error:'草稿正在同步或存在内容冲突',code:'DRAFT_BUSY'},409)
  throw error
}

contentRoutes.get('/drafts/:draftId/content/:ref/:id',async c => {
  try { return c.json(await readContent(await contextFor(c),kindSchema.parse(c.req.param('ref')),c.req.param('id'),c.req.query('locale') ?? 'en')) }
  catch(error) { return errorResponse(error,c) }
})
contentRoutes.post('/drafts/:draftId/content/:ref',async c => {
  try {
    const content = contentSchema.parse(await c.req.json())
    if (content.ref !== c.req.param('ref')) throw new ContentError('VALIDATION_FAILED')
    return c.json(await createContent(await contextFor(c),content),201)
  } catch(error) { return errorResponse(error,c) }
})
contentRoutes.put('/drafts/:draftId/content/:ref/:id',async c => {
  try {
    const content = contentSchema.parse(await c.req.json())
    if (content.ref !== c.req.param('ref')) throw new ContentError('VALIDATION_FAILED')
    return c.json(await saveContent(await contextFor(c),c.req.param('id'),content,requestRevision(c)))
  } catch(error) { return errorResponse(error,c) }
})
contentRoutes.delete('/drafts/:draftId/content/:ref/:id',async c => {
  try {
    await deleteContent(await contextFor(c),kindSchema.parse(c.req.param('ref')),c.req.param('id'),requestRevision(c))
    return c.body(null,204)
  } catch(error) { return errorResponse(error,c) }
})

contentRoutes.post('/drafts/:draftId/collections/:collectionId/reorder',requireAuth,async c=>{
  try {
    const body = z.object({ref:z.enum(['group','item']),orders:z.array(z.object({id:z.string(),order:z.number().int()}).strict()),revision:z.string(),locale:z.string().default('en')}).strict().parse(await c.req.json())
    return c.json(await reorderContent(await contextFor(c),c.req.param('collectionId')!,body.ref,body.orders,body.revision,body.locale))
  } catch(error) { return errorResponse(error,c) }
})

for (const {ref,plural,base} of [
  {ref:'page',plural:'pages',base:'/drafts/:draftId/pages'},
  {ref:'collection',plural:'collections',base:'/drafts/:draftId/collections'},
  {ref:'group',plural:'groups',base:'/drafts/:draftId/collections/:collectionId/groups'},
  {ref:'item',plural:'items',base:'/drafts/:draftId/collections/:collectionId/items'},
] as const) {
  contentRoutes.get(base,requireAuth,async c => {
    try {
      const result = await listContent(await contextFor(c),ref,{locale:c.req.query('locale'),collectionId:c.req.param('collectionId'),q:c.req.query('q'),status:c.req.query('status'),limit:c.req.query('limit') ? Number(c.req.query('limit')) : undefined,cursor:c.req.query('cursor')})
      return c.json({[plural]:result.contents,pageInfo:result.pageInfo})
    } catch(error) { return errorResponse(error,c) }
  })
  contentRoutes.post(base,requireAuth,async c => {
    try {
      const content = contentSchema.parse(await c.req.json())
      if (content.ref !== ref) throw new ContentError('VALIDATION_FAILED')
      if (c.req.param('collectionId')) content.collectionId = c.req.param('collectionId')
      const result = await createContent(await contextFor(c),content)
      return c.json({[ref]:result.content,revision:result.revision},201)
    } catch(error) { return errorResponse(error,c) }
  })
  contentRoutes.get(`${base}/:id`,requireAuth,async c => {
    try {
      const result = await readContent(await contextFor(c),ref,c.req.param('id')!,c.req.query('locale') ?? 'en')
      return c.json({[ref]:result.content,revision:result.revision})
    } catch(error) { return errorResponse(error,c) }
  })
  contentRoutes.put(`${base}/:id`,requireAuth,async c => {
    try {
      const content = contentSchema.parse(await c.req.json())
      if (content.ref !== ref) throw new ContentError('VALIDATION_FAILED')
      if (c.req.param('collectionId')) content.collectionId = c.req.param('collectionId')
      const result = await saveContent(await contextFor(c),c.req.param('id')!,content,requestRevision(c))
      return c.json({[ref]:result.content,revision:result.revision})
    } catch(error) { return errorResponse(error,c) }
  })
  contentRoutes.delete(`${base}/:id`,requireAuth,async c => {
    try { await deleteContent(await contextFor(c),ref,c.req.param('id')!,requestRevision(c)); return c.body(null,204) }
    catch(error) { return errorResponse(error,c) }
  })
}
