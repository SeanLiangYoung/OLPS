import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import { gitOrThrow } from './git-exec.js'
import { sandboxRoot, siteManifestWithVerify } from './test-helpers.js'

describe('Sync 仓库换行配置', () => {
  it('新建工作区仓库 local core.autocrlf 为 false', async () => {
    const sandbox = await sandboxRoot('line-ending-policy')
    const ws = await SyncWorkspace.create({
      sandboxRoot: sandbox,
      draftId: 'draft-le',
      remote: { baseUrl: 'http://127.0.0.1:1', token: 'unused' },
      build: {
        verifyCommand: JSON.parse(siteManifestWithVerify()).verifyCommand,
        buildCommand: JSON.parse(siteManifestWithVerify()).buildCommand,
      },
    })
    const workspacePath = `${sandbox}/draft-le`
    const autocrlf = gitOrThrow(workspacePath, ['config', '--get', 'core.autocrlf'])
    expect(autocrlf).toBe('false')
    await ws.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify(), 'utf8'))
    await ws.saveVersion('le check')
  })
})
