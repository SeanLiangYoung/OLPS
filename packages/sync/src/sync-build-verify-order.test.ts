import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { SyncWorkspace } from './index.js'
import { sandboxRoot } from './test-helpers.js'

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const dummyRemote = { baseUrl: 'http://127.0.0.1:9', token: 'test-token-unused' }

describe('runValidation 命令顺序', () => {
  it('先 build 后 verify', async () => {
    const build = path.join(packageDir, '..', 'test-fixtures', 'order-build.mjs')
    const verify = path.join(packageDir, '..', 'test-fixtures', 'order-verify.mjs')
    const ws = await SyncWorkspace.create({
      sandboxRoot: await sandboxRoot('order'),
      draftId: 'draft-order',
      remote: dummyRemote,
      build: {
        buildCommand: [process.execPath, build],
        verifyCommand: [process.execPath, verify],
      },
    })
    const result = await ws.runValidation()
    expect(result.ok).toBe(true)
  })
})
