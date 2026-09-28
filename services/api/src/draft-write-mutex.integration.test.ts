import { spawnSync } from 'node:child_process'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { GuideGraph } from '@olps/domain'
import { app } from './app.js'
import { withDraftLock } from './draft-lock.js'
import {
  createDraft,
  createDraftPage,
  patchDraftPageForUser,
  patchDraftSettings,
} from './drafts-service.js'
import { runGeneratePageJob } from './collaboration-jobs.js'
import { generatePageContent } from './generate.js'
import { patchPageGuide } from './page-routes.js'
import { openDraftWorkspace, readSiteSettingsFromWorkspace } from './workspace-factory.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'

async function nextMicrotask(): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve)
  })
}

async function waitUntilPromisePending(promise: Promise<unknown>): Promise<void> {
  let settled = false
  void promise.finally(() => {
    settled = true
  })
  for (let i = 0; i < 64 && !settled; i += 1) {
    await nextMicrotask()
  }
  expect(settled).toBe(false)
}

type DraftDbSnapshot = {
  headCommitId: string | null
  syncStatus: string
  pageCount: number
  gitHead: string
  settingsJson: string
}

function createPoolSnapshotLoader(pool: ReturnType<typeof createTestPool>) {
  return async function loadDraftDbSnapshot(draftId: string): Promise<DraftDbSnapshot> {
  const draftRow = await pool.query(
    `SELECT sandbox_id, site_id, base_commit_id, head_commit_id, sync_status FROM site_drafts WHERE draft_id=$1`,
    [draftId],
  )
  if (!draftRow.rowCount) {
    throw new Error(`草稿不存在: ${draftId}`)
  }
  const row = draftRow.rows[0]!
  const pageCountRow = await pool.query(
    `SELECT COUNT(*)::int AS c FROM pages WHERE draft_id=$1`,
    [draftId],
  )
  const workspace = await openDraftWorkspace({
    draftId,
    sandboxId: String(row.sandbox_id),
    siteId: row.site_id ? String(row.site_id) : null,
    baseCommitId: row.base_commit_id ? String(row.base_commit_id) : null,
    headCommitId: row.head_commit_id ? String(row.head_commit_id) : null,
  })
  const state = workspace.getState()
  const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: state.workspacePath,
    encoding: 'utf8',
  })
  if (gitHead.status !== 0) {
    throw new Error(`git rev-parse 失败: ${gitHead.stderr}`)
  }
  const settings = await readSiteSettingsFromWorkspace(workspace)
  return {
    headCommitId: row.head_commit_id ? String(row.head_commit_id) : null,
    syncStatus: String(row.sync_status),
    pageCount: Number(pageCountRow.rows[0]!.c),
    gitHead: gitHead.stdout.trim(),
    settingsJson: JSON.stringify(settings),
  }
  }
}

async function holdDraftLockUntilRelease(
  draftId: string,
  onHeld: () => void,
  releaseGate: Promise<void>,
): Promise<void> {
  await withDraftLock(draftId, async () => {
    onHeld()
    await releaseGate
  })
}

describe('同一草稿写操作与 withDraftLock 互斥（真实 Git 与 PG）', () => {
  const pool = createTestPool()
  const loadDraftDbSnapshot = createPoolSnapshotLoader(pool)

  beforeEach(async () => {
    requireRemoteServiceConfig()
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function createOwnedDraft(account: string): Promise<{ userId: string; draftId: string }> {
    const reg = await registerUser(app, {
      account,
      password: `${account}-pass`,
      name: account,
    })
    expect(reg.status).toBe(201)
    const userId = String(reg.user.userId)
    const draft = await createDraft({ userId, name: `${account} draft` })
    return { userId, draftId: draft.draftId }
  }

  it('patchDraftSettings 在锁释放前不得改变 Git HEAD 与草稿 sync 状态', async () => {
    const { userId, draftId } = await createOwnedDraft('mutex-settings')
    const release = Promise.withResolvers<void>()
    const held = Promise.withResolvers<void>()
    void holdDraftLockUntilRelease(draftId, () => held.resolve(), release.promise)
    await held.promise

    const before = await loadDraftDbSnapshot(draftId)
    const op = patchDraftSettings(userId, draftId, { defaultLocale: 'zh-CN' })
    await waitUntilPromisePending(op)
    expect(await loadDraftDbSnapshot(draftId)).toEqual(before)
    release.resolve()
    await op
    expect(await loadDraftDbSnapshot(draftId)).not.toEqual(before)
  })

  it('createDraftPage 在锁释放前不得增加 pages 行或产生新 Git 提交', async () => {
    const { userId, draftId } = await createOwnedDraft('mutex-create-page')
    const release = Promise.withResolvers<void>()
    const held = Promise.withResolvers<void>()
    void holdDraftLockUntilRelease(draftId, () => held.resolve(), release.promise)
    await held.promise

    const before = await loadDraftDbSnapshot(draftId)
    const op = createDraftPage(userId, draftId, {
      kind: 'content',
      title: 'Mutex Page',
      slug: 'mutex-page',
    })
    await waitUntilPromisePending(op)
    expect(await loadDraftDbSnapshot(draftId)).toEqual(before)
    release.resolve()
    await op
    expect(await loadDraftDbSnapshot(draftId)).not.toEqual(before)
  })

  it('patchDraftPageForUser 在锁释放前不得更新 pages 行或 Git HEAD', async () => {
    const { userId, draftId } = await createOwnedDraft('mutex-patch-page')
    const page = await createDraftPage(userId, draftId, {
      kind: 'content',
      title: 'Original',
      slug: 'orig-slug',
    })
    const release = Promise.withResolvers<void>()
    const held = Promise.withResolvers<void>()
    void holdDraftLockUntilRelease(draftId, () => held.resolve(), release.promise)
    await held.promise

    const before = await loadDraftDbSnapshot(draftId)
    const pagesBefore = await pool.query(`SELECT title, slug, body, seo FROM pages WHERE draft_id=$1`, [
      draftId,
    ])
    const op = patchDraftPageForUser(userId, draftId, page.pageId, { title: 'Patched While Locked' })
    await waitUntilPromisePending(op)
    expect(await loadDraftDbSnapshot(draftId)).toEqual(before)
    const pagesDuring = await pool.query(`SELECT title, slug, body, seo FROM pages WHERE draft_id=$1`, [
      draftId,
    ])
    expect(JSON.stringify(pagesDuring.rows)).toBe(JSON.stringify(pagesBefore.rows))
    release.resolve()
    await op
    const pagesAfter = await pool.query(`SELECT title FROM pages WHERE draft_id=$1 AND page_id=$2`, [
      draftId,
      page.pageId,
    ])
    expect(String(pagesAfter.rows[0]!.title)).toBe('Patched While Locked')
  })

  it('patchPageGuide 在锁释放前不得写入 guide 变更', async () => {
    const { userId, draftId } = await createOwnedDraft('mutex-guide')
    const generated = generatePageContent({
      kind: 'ads',
      title: 'Ads Guide',
      slug: 'ads-guide',
      brief: 'brief',
      locale: 'en',
      keywords: ['kw'],
    })
    const page = await createDraftPage(userId, draftId, {
      kind: 'ads',
      title: 'Ads Guide',
      slug: 'ads-guide',
    })
    await patchDraftPageForUser(userId, draftId, page.pageId, {
      body: generated.body,
      seo: generated.seo,
    })
    const guideBefore = await pool.query(`SELECT body FROM pages WHERE draft_id=$1 AND page_id=$2`, [
      draftId,
      page.pageId,
    ])
    const release = Promise.withResolvers<void>()
    const held = Promise.withResolvers<void>()
    void holdDraftLockUntilRelease(draftId, () => held.resolve(), release.promise)
    await held.promise

    const before = await loadDraftDbSnapshot(draftId)
    const currentGuide = (guideBefore.rows[0]!.body as { ads?: { guide: GuideGraph } }).ads!.guide
    const nextGuide = structuredClone(currentGuide)
    nextGuide.nodes['entry-0'].options[0]!.label = 'Mutex Guide Edit'
    const op = patchPageGuide(userId, draftId, page.pageId, nextGuide)
    await waitUntilPromisePending(op)
    expect(await loadDraftDbSnapshot(draftId)).toEqual(before)
    const bodyDuring = await pool.query(`SELECT body FROM pages WHERE draft_id=$1 AND page_id=$2`, [
      draftId,
      page.pageId,
    ])
    expect(JSON.stringify(bodyDuring.rows[0]!.body)).toBe(JSON.stringify(guideBefore.rows[0]!.body))
    release.resolve()
    await op
    const bodyAfter = await pool.query(`SELECT body FROM pages WHERE draft_id=$1 AND page_id=$2`, [
      draftId,
      page.pageId,
    ])
    expect(JSON.stringify(bodyAfter.rows[0]!.body)).not.toBe(JSON.stringify(guideBefore.rows[0]!.body))
  })

  it('runGeneratePageJob 在锁释放前不得创建新页面', async () => {
    const account = 'mutex-generate'
    const { userId, draftId } = await createOwnedDraft(account)
    const login = await requestJson(app, 'POST', '/api/auth/login', {
      body: { account, password: `${account}-pass` },
    })
    expect(login.status).toBe(200)
    const token = String(login.body.accessToken)
    const kb = await requestJson(app, 'POST', '/api/knowledge-bases', {
      token,
      body: { name: 'Mutex KB' },
    })
    expect(kb.status).toBe(201)
    const kbId = String((kb.body.knowledgeBase as Record<string, unknown>).kbId)

    const release = Promise.withResolvers<void>()
    const held = Promise.withResolvers<void>()
    void holdDraftLockUntilRelease(draftId, () => held.resolve(), release.promise)
    await held.promise

    const before = await loadDraftDbSnapshot(draftId)
    const op = runGeneratePageJob({
      userId,
      draftId,
      knowledgeBaseId: kbId,
      kind: 'content',
      title: 'Generated Mutex',
      slug: 'generated-mutex',
      brief: 'brief',
    })
    await waitUntilPromisePending(op)
    expect(await loadDraftDbSnapshot(draftId)).toEqual(before)
    release.resolve()
    await op
    const after = await loadDraftDbSnapshot(draftId)
    expect(after.pageCount).toBe(before.pageCount + 1)
  })

  it('不同 draft 的 withDraftLock 可同时持有，互不阻塞', async () => {
    const first = await createOwnedDraft('mutex-draft-a')
    const second = await createOwnedDraft('mutex-draft-b')
    const holdA = Promise.withResolvers<void>()
    const holdB = Promise.withResolvers<void>()
    const enteredA = Promise.withResolvers<void>()
    const enteredB = Promise.withResolvers<void>()

    void withDraftLock(first.draftId, async () => {
      enteredA.resolve()
      await holdA.promise
    })
    void withDraftLock(second.draftId, async () => {
      enteredB.resolve()
      await holdB.promise
    })

    await Promise.all([enteredA.promise, enteredB.promise])
    holdA.resolve()
    holdB.resolve()
  })
})
