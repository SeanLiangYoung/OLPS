import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SyncWorkspace } from './index.js'
import { sandboxRoot } from './test-helpers.js'

const dummyRemote = { baseUrl: 'http://127.0.0.1:9', token: 'unused' }

describe('SyncWorkspace 路径安全', () => {
  it('拒绝 Windows 大小写变体 .GIT 路径写入', async () => {
    const ws = await SyncWorkspace.create({
      sandboxRoot: await sandboxRoot('git-case'),
      draftId: 'draft-git-case',
      remote: dummyRemote,
    })
    await expect(ws.writeFile('.GIT/config', Buffer.from('x'))).rejects.toThrow(/\.git/i)
    await expect(ws.writeFile('.Git/HEAD', Buffer.from('x'))).rejects.toThrow(/\.git/i)
  })
})
