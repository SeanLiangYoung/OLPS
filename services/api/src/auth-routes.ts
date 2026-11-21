import { Hono } from 'hono'
import { z } from 'zod'
import { getAuthUser, requireAuth, type AuthVariables } from './auth-middleware.js'
import { verifyPassword } from './password.js'
import { createUser, findUserByAccount } from './users.js'
import { createAccessToken, createSession, deleteSessionByToken } from './sessions.js'

export const authRoutes = new Hono<{ Variables: AuthVariables }>()
const loginSchema = z.object({ account: z.string().trim().min(1), password: z.string().min(1) })

authRoutes.post('/auth/register', async c => {
  const input = loginSchema.extend({ name: z.string().trim().optional() }).safeParse(await c.req.json())
  if (!input.success) return c.json({ error: '账号和密码不能为空', code: 'VALIDATION_FAILED' }, 400)
  const { account, password } = input.data
  if (await findUserByAccount(account)) return c.json({ error: '账号已存在', code: 'ACCOUNT_EXISTS' }, 409)
  let user:Awaited<ReturnType<typeof createUser>>
  try { user=await createUser({ account, password, name: input.data.name || account }) }
  catch(error) {
    if(error && typeof error==='object' && 'code' in error && error.code==='23505' && 'constraint' in error && error.constraint==='users_account_key')return c.json({error:'账号已存在',code:'ACCOUNT_EXISTS'},409)
    throw error
  }
  const accessToken = createAccessToken()
  await createSession(user.userId, accessToken)
  return c.json({ accessToken, user }, 201)
})

authRoutes.post('/auth/login', async c => {
  const input = loginSchema.safeParse(await c.req.json())
  if (!input.success) return c.json({ error: '账号和密码不能为空', code: 'VALIDATION_FAILED' }, 400)
  const record = await findUserByAccount(input.data.account)
  if (!record || !verifyPassword(input.data.password, record.passwordHash)) return c.json({ error: '账号或密码错误', code: 'INVALID_CREDENTIALS' }, 401)
  const accessToken = createAccessToken()
  await createSession(record.userId, accessToken)
  const { passwordHash: _passwordHash, ...user } = record
  return c.json({ accessToken, user })
})

authRoutes.get('/auth/me', requireAuth, c => c.json({ user: getAuthUser(c) }))
authRoutes.post('/auth/logout', requireAuth, async c => { await deleteSessionByToken(c.get('accessToken')); return c.json({ ok: true }) })
