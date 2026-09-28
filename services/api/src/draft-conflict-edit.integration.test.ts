import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { SITE_PATHS } from '@olps/sync'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { appConfig } from './config.js'

function gitHead(workspacePath: string): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspacePath, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git rev-parse 失败: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function readSettingsJson(sandboxId: string): string {
  const file = path.join(appConfig.sandboxRoot, sandboxId, SITE_PATHS.siteSettings)
  return fs.readFileSync(file, 'utf8')
}

function listPageJsonFiles(sandboxId: string): string[] {
  const dir = path.join(appConfig.sandboxRoot, sandboxId, SITE_PATHS.pagesDir)
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
}

function readPageJsonFilesSnapshot(sandboxId: string): string {
  const files = listPageJsonFiles(sandboxId)
  const parts = files.map((name) => {
    const full = path.join(appConfig.sandboxRoot, sandboxId, SITE_PATHS.pagesDir, name)
    return `${name}:${fs.readFileSync(full, 'utf8')}`
  })
  return parts.join('\n---\n')
}

describe('awaiting_user 状态下普通编辑须拒绝且不改动 Git/文件/索引', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    requireRemoteServiceConfig()
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function tokenFor(account: string): Promise<string> {
    const reg = await registerUser(app, {
      account,
      password: 'conflict-edit-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  async function setupAwaitingUserDraft(): Promise<{
    tokenB: string
    draftBId: string
    sandboxId: string
  }> {
    const tokenA = await tokenFor('conflict-edit-a')
    const tokenB = await tokenFor('conflict-edit-b')

    const draftA = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Conflict Edit Site' },
    })
    expect(draftA.status).toBe(201)
    const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)

    const page = await requestJson(app, 'POST', `/api/drafts/${draftAId}/pages`, {
      token: tokenA,
      body: { kind: 'content', title: 'Shared', slug: 'conflict-shared' },
    })
    expect(page.status).toBe(201)
    const sharedPageId = String((page.body.page as Record<string, unknown>).pageId)

    const pushV1 = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
    expect(pushV1.status).toBe(200)
    const siteId = String((pushV1.body.site as Record<string, unknown>).siteId)

    await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
      token: tokenA,
      body: { account: 'conflict-edit-b' },
    })

    const draftB = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenB,
      body: { name: 'Conflict fork B', siteId },
    })
    expect(draftB.status).toBe(201)
    const draftBId = String((draftB.body.draft as Record<string, unknown>).draftId)
    const sandboxId = String((draftB.body.draft as Record<string, unknown>).sandboxId)

    const pagesB = await requestJson(app, 'GET', `/api/drafts/${draftBId}/pages`, { token: tokenB })
    const pageOnB = (pagesB.body.pages as Array<Record<string, unknown>>).find(
      (p) => p.slug === 'conflict-shared',
    )!
    const sharedOnB = String(pageOnB.pageId)

    await requestJson(app, 'PATCH', `/api/drafts/${draftAId}/pages/${sharedPageId}`, {
      token: tokenA,
      body: { body: { html: '<h1>conflict-marker-a</h1>' } },
    })
    await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })

    await requestJson(app, 'PATCH', `/api/drafts/${draftBId}/pages/${sharedOnB}`, {
      token: tokenB,
      body: { body: { html: '<h1>conflict-marker-b</h1>' } },
    })

    const pullB = await requestJson(app, 'POST', `/api/drafts/${draftBId}/pull`, { token: tokenB })
    expect(pullB.status).toBe(409)
    const draftAfterPull = pullB.body.draft as Record<string, unknown>
    expect(String(draftAfterPull.syncStatus)).toBe('awaiting_user')

    return { tokenB, draftBId, sandboxId }
  }

  it(
    'createDraftPage 在 awaiting_user 下须失败且 pages 行数、pages 目录与 Git HEAD 不变',
    async () => {
    const { tokenB, draftBId, sandboxId } = await setupAwaitingUserDraft()
    const workspacePath = path.join(appConfig.sandboxRoot, sandboxId)
    const headBefore = gitHead(workspacePath)
    const settingsBefore = readSettingsJson(sandboxId)
    const pagesFilesBefore = readPageJsonFilesSnapshot(sandboxId)
    const countBefore = await pool.query(`SELECT COUNT(*)::int AS c FROM pages WHERE draft_id=$1`, [
      draftBId,
    ])

    const created = await requestJson(app, 'POST', `/api/drafts/${draftBId}/pages`, {
      token: tokenB,
      body: { kind: 'content', title: 'Blocked', slug: 'blocked-page' },
    })
    expect(created.status).not.toBe(201)

    const countAfter = await pool.query(`SELECT COUNT(*)::int AS c FROM pages WHERE draft_id=$1`, [
      draftBId,
    ])
    expect(Number(countAfter.rows[0]!.c)).toBe(Number(countBefore.rows[0]!.c))
    expect(gitHead(workspacePath)).toBe(headBefore)
    expect(readSettingsJson(sandboxId)).toBe(settingsBefore)
    expect(readPageJsonFilesSnapshot(sandboxId)).toBe(pagesFilesBefore)
    },
    1_200_000,
  )

  it(
    'patchDraftSettings 在 awaiting_user 下须失败且 site-settings 文件与 Git HEAD 不变',
    async () => {
    const { tokenB, draftBId, sandboxId } = await setupAwaitingUserDraft()
    const workspacePath = path.join(appConfig.sandboxRoot, sandboxId)
    const headBefore = gitHead(workspacePath)
    const settingsBefore = readSettingsJson(sandboxId)
    const pagesFilesBefore = readPageJsonFilesSnapshot(sandboxId)

    const patched = await requestJson(app, 'PATCH', `/api/drafts/${draftBId}/settings`, {
      token: tokenB,
      body: { defaultLocale: 'zh-CN' },
    })
    expect(patched.status).not.toBe(200)

    expect(readSettingsJson(sandboxId)).toBe(settingsBefore)
    expect(gitHead(workspacePath)).toBe(headBefore)
    expect(readPageJsonFilesSnapshot(sandboxId)).toBe(pagesFilesBefore)
    },
    1_200_000,
  )
})
