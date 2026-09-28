import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { SyncWorkspace } from '@olps/sync'
import { app } from './app.js'
import { resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function pathFieldsForWorkspace(workspacePath: string): Record<string, unknown> {
  const gitFile = path.join(workspacePath, '.git')
  const gitStat = fs.existsSync(gitFile) ? fs.statSync(gitFile) : null
  const gitFileContent = gitStat?.isFile() ? fs.readFileSync(gitFile, 'utf8').trim() : null
  const absGitDir = git(workspacePath, ['rev-parse', '--absolute-git-dir'])
  const commonGitDir = git(workspacePath, ['rev-parse', '--git-common-dir'])
  return {
    workspacePath,
    workspacePathLength: workspacePath.length,
    gitEntryIsFile: gitStat?.isFile() ?? false,
    gitFileContent,
    absoluteGitDir: absGitDir.stdout.trim(),
    absoluteGitDirLength: absGitDir.stdout.trim().length,
    gitCommonDir: commonGitDir.stdout.trim(),
    gitCommonDirLength: commonGitDir.stdout.trim().length,
  }
}

describe('Git bundle 与 linked worktree（API sandbox 路径）', () => {
  beforeEach(async () => {
    requireRemoteServiceConfig()
    await resetTestDatabase()
  })

  afterAll(async () => {})

  it('关联网站草稿 clone 后 git bundle create 在 worktree 目录执行须成功', async () => {
    const tokenA = (
      await registerUser(app, {
        account: 'git-wt-a',
        password: 'git-wt-pass',
        name: 'git-wt-a',
      })
    ).accessToken

    const draftA = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Git WT Site A' },
    })
    expect(draftA.status).toBe(201)
    const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)

    await requestJson(app, 'POST', `/api/drafts/${draftAId}/pages`, {
      token: tokenA,
      body: { kind: 'content', title: 'Page', slug: 'git-wt-page' },
    })

    const pushA = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
    expect(pushA.status).toBe(200)
    const siteId = String((pushA.body.site as Record<string, unknown>).siteId)

    const draftB = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Git WT Fork B', siteId },
    })
    expect(draftB.status).toBe(201)
    const draftBId = String((draftB.body.draft as Record<string, unknown>).draftId)
    const sandboxId = String((draftB.body.draft as Record<string, unknown>).sandboxId)

    const sandboxRoot = process.env.SANDBOX_ROOT ?? ''
    const workspacePath = path.join(sandboxRoot, sandboxId)
    const fields = pathFieldsForWorkspace(workspacePath)
    expect(fields.gitEntryIsFile).toBe(true)

    const bundleOut = path.join(sandboxRoot, '.o', 'bundles', `${draftBId}-probe.bundle`)
    fs.mkdirSync(path.dirname(bundleOut), { recursive: true })

    const worktreeHead = git(workspacePath, ['rev-parse', 'HEAD'])
    expect(worktreeHead.status, JSON.stringify(fields, null, 2)).toBe(0)
    expect(worktreeHead.stdout.trim().length).toBeGreaterThan(0)

    const createFromWorktree = git(workspacePath, ['bundle', 'create', bundleOut, 'HEAD'])
    const evidence = {
      ...fields,
      worktreeHead: worktreeHead.stdout.trim(),
      createFromWorktree: {
        status: createFromWorktree.status,
        stderr: createFromWorktree.stderr.trim(),
      },
      gitVersion: git(workspacePath, ['--version']).stdout.trim(),
    }
    expect(createFromWorktree.status, JSON.stringify(evidence, null, 2)).toBe(0)

    const pagesB = await requestJson(app, 'GET', `/api/drafts/${draftBId}/pages`, { token: tokenA })
    expect(pagesB.status).toBe(200)
    const pageList = pagesB.body.pages as Array<Record<string, unknown>>
    const target = pageList.find((p) => p.slug === 'git-wt-page') ?? pageList[0]
    const pageIdB = String(target!.pageId)
    await requestJson(app, 'PATCH', `/api/drafts/${draftBId}/pages/${pageIdB}`, {
      token: tokenA,
      body: { body: { html: '<h1>git-wt-publish-marker</h1>' } },
    })
    const pushB = await requestJson(app, 'POST', `/api/drafts/${draftBId}/push`, { token: tokenA })
    expect(pushB.status, JSON.stringify({ status: pushB.status, error: pushB.body.error }, null, 2)).toBe(
      200,
    )
    const publicUrl = String((pushB.body.site as Record<string, unknown>).publicUrl)
    const live = await fetch(`${publicUrl.replace(/\/+$/, '')}/git-wt-page/`)
    expect(live.status).toBe(200)
    const liveHtml = await live.text()
    expect(liveHtml).toContain('git-wt-publish-marker')
  })

  it('嵌套较深 sandboxRoot 下 SyncWorkspace push 须成功（bundle 在 worktree cwd）', async () => {
    const remote = requireRemoteServiceConfig()
    const tokenA = (
      await registerUser(app, {
        account: 'git-wt-long-a',
        password: 'git-wt-pass',
        name: 'git-wt-long-a',
      })
    ).accessToken

    const draftA = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Long Path Seed' },
    })
    const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)
    await requestJson(app, 'POST', `/api/drafts/${draftAId}/pages`, {
      token: tokenA,
      body: { kind: 'content', title: 'P', slug: 'long-path-p' },
    })
    const pushA = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
    expect(pushA.status).toBe(200)

    const siteId = String((pushA.body.site as Record<string, unknown>).siteId)
    const siteRes = await requestJson(app, 'GET', `/api/sites/${siteId}`, { token: tokenA })
    const remoteSiteId = String((siteRes.body.site as Record<string, unknown>).remoteSiteId)
    const publishedCommitId = String(
      (siteRes.body.site as Record<string, unknown>).publishedCommitId,
    )

    const longSandboxRoot = path.join(
      apiRoot,
      '.intermediate',
      'sandboxes-test-nested-for-git-dir',
    )
    await fs.promises.rm(longSandboxRoot, { recursive: true, force: true })
    await fs.promises.mkdir(longSandboxRoot, { recursive: true })

    const draftId = randomUUID()
    const ws = await SyncWorkspace.create({
      sandboxRoot: longSandboxRoot,
      draftId,
      remote,
      remoteSiteId,
      baseCommitId: publishedCommitId,
    })
    const workspacePath = ws.getState().workspacePath
    const fields = pathFieldsForWorkspace(workspacePath)

    const pushed = await ws.push({ expectedPublishedCommitId: publishedCommitId })
    const evidence = {
      ...fields,
      longSandboxRoot,
      longSandboxRootLength: longSandboxRoot.length,
      pushStatus: pushed.status,
      pushError: pushed.error,
    }

    expect(pushed.status, JSON.stringify(evidence, null, 2)).toBe('clean')
  })
})
