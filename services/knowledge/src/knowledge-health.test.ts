import { describe, expect, it } from 'vitest'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'

const token = 'knowledge-test-token'

describe('knowledge HTTP 存活检查', () => {
  it('携带正确令牌时 GET /health 返回成功', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('health-ok')
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
    })
    try {
      const res = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string }
      expect(body.status).toBe('ok')
    } finally {
      close()
    }
  })

  it('未携带令牌时 GET /health 返回 401', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('health-no-token')
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
    })
    try {
      const res = await fetch(`${baseUrl}/health`)
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })

  it('错误令牌时 GET /health 返回 401', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('health-wrong-token')
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
    })
    try {
      const res = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: 'Bearer wrong-token' },
      })
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })
})