import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { loginUser, registerUser, requestJson } from './test-support/http.js'

describe('协作账号与会话', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  it('注册返回 accessToken 与 user 字段', async () => {
    const out = await registerUser(app, {
      account: 'alice',
      password: 'secret-pass',
      name: 'Alice',
    })
    expect(out.status).toBe(201)
    expect(out.accessToken.length).toBeGreaterThan(20)
    expect(out.user.account).toBe('alice')
    expect(out.user.name).toBe('Alice')
    expect(out.user.userId).toBeTruthy()
  })

  it('重复账号注册被拒绝', async () => {
    await registerUser(app, {
      account: 'dup',
      password: 'secret-pass',
      name: 'One',
    })
    const second = await registerUser(app, {
      account: 'dup',
      password: 'other-pass',
      name: 'Two',
    })
    expect(second.status).toBe(409)
  })

  it('密码错误时登录返回 401', async () => {
    await registerUser(app, {
      account: 'bob',
      password: 'right-pass',
      name: 'Bob',
    })
    const login = await loginUser(app, {
      account: 'bob',
      password: 'wrong-pass',
    })
    expect(login.status).toBe(401)
  })

  it('登录成功返回 accessToken 与 user', async () => {
    await registerUser(app, {
      account: 'carol',
      password: 'carol-pass',
      name: 'Carol',
    })
    const login = await loginUser(app, {
      account: 'carol',
      password: 'carol-pass',
    })
    expect(login.status).toBe(200)
    expect(login.accessToken.length).toBeGreaterThan(20)
    expect(login.user.account).toBe('carol')
  })

  it('GET /api/auth/me 返回当前用户', async () => {
    const reg = await registerUser(app, {
      account: 'me-user',
      password: 'me-pass',
      name: 'Me User',
    })
    const me = await requestJson(app, 'GET', '/api/auth/me', {
      token: reg.accessToken,
    })
    expect(me.status).toBe(200)
    const user = me.body.user as Record<string, unknown>
    expect(user.account).toBe('me-user')
  })

  it('未携带 token 访问受保护接口返回 401', async () => {
    const res = await requestJson(app, 'GET', '/api/drafts')
    expect(res.status).toBe(401)
  })

  it('退出登录后会话失效', async () => {
    const reg = await registerUser(app, {
      account: 'logout-user',
      password: 'logout-pass',
      name: 'Logout',
    })
    const logout = await requestJson(app, 'POST', '/api/auth/logout', {
      token: reg.accessToken,
    })
    expect(logout.status).toBe(200)
    const me = await requestJson(app, 'GET', '/api/auth/me', {
      token: reg.accessToken,
    })
    expect(me.status).toBe(401)
  })

  it('注册后 users 表存在对应账号记录', async () => {
    await registerUser(app, {
      account: 'db-check',
      password: 'db-pass',
      name: 'Db Check',
    })
    const result = await pool.query(`SELECT account, name FROM users WHERE account=$1`, ['db-check'])
    expect(result.rowCount).toBe(1)
    expect(String(result.rows[0]!.name)).toBe('Db Check')
  })
})
