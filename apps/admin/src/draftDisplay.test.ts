import { describe, expect, it } from 'vitest'
import {
  draftStatusLabel,
  formatCommitRef,
  isKnownDraftStatus,
  pushSuccessMessage,
  syncActionDisabledReason,
  syncProcessingLabel,
} from './draftDisplay'
import type { SiteDraft, SiteSettings } from './types'

const emptySettings: SiteSettings = {
  defaultLocale: 'en',
  locales: ['en'],
  screenCap: 8,
  analyticsEnabled: false,
  mapsEnabled: false,
  mapsApiKey: '',
  whatsappEnabled: false,
  whatsappNumber: '',
  whatsappLabel: '',
}

function draftFixture(overrides: Partial<SiteDraft> = {}): SiteDraft {
  return {
    draftId: 'd-retry',
    siteId: 'site-1',
    name: 'Retry Draft',
    settings: emptySettings,
    sandboxId: 'sandbox-1',
    baseCommitId: 'base111',
    headCommitId: 'head222',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('draftDisplay', () => {
  it('映射 API 四态为界面文案', () => {
    expect(draftStatusLabel('active')).toBe('就绪')
    expect(draftStatusLabel('syncing')).toBe('同步处理中')
    expect(draftStatusLabel('conflict')).toBe('等待用户决定')
    expect(draftStatusLabel('error')).toBe('同步失败')
  })

  it('未知 API 状态不伪装为就绪', () => {
    expect(isKnownDraftStatus('archived')).toBe(false)
    expect(draftStatusLabel('archived')).toBe('未识别的状态 archived')
  })

  it('展示 sync 内部处理状态', () => {
    expect(syncProcessingLabel('awaiting_user')).toBe('等待用户输入决定')
    expect(syncProcessingLabel('merge_conflict')).toBe('合并冲突处理中')
  })

  it('格式化 commit 短标识', () => {
    expect(formatCommitRef('abcdef1234567890')).toBe('abcdef1')
    expect(formatCommitRef(null)).toBe('—')
  })

  it('处理中状态禁止再次 push', () => {
    const draft: SiteDraft = {
      draftId: 'd1',
      siteId: null,
      name: 'Test',
      settings: emptySettings,
      sandboxId: 's1',
      baseCommitId: null,
      headCommitId: null,
      status: 'syncing',
      createdAt: '',
      updatedAt: '',
    }
    expect(syncActionDisabledReason(draft, 'push')).toBe('当前草稿正在同步处理中')
    expect(syncActionDisabledReason({ ...draft, status: 'active' }, 'push')).toBe('')
  })

  it('冲突状态禁止 pull 直到用户处理', () => {
    const draft: SiteDraft = {
      draftId: 'd1',
      siteId: 'site-1',
      name: 'Test',
      settings: emptySettings,
      sandboxId: 's1',
      baseCommitId: 'a',
      headCommitId: 'b',
      status: 'conflict',
      conflictMessage: '需要决定首页标题',
      createdAt: '',
      updatedAt: '',
    }
    expect(syncActionDisabledReason(draft, 'pull')).toContain('等待用户决定')
  })

  describe('syncActionDisabledReason：error 后可重试 Push', () => {
    const lastError = 'remote: connection reset by peer'

    it('status=error、syncStatus=clean、pendingOperation=push、有 lastError 时允许 Push', () => {
      const draft = draftFixture({
        status: 'error',
        syncStatus: 'clean',
        pendingOperation: 'push',
        lastError,
      })
      expect(syncActionDisabledReason(draft, 'push')).toBe('')
    })

    it('status=error、syncStatus=dirty、pendingOperation=push、有 lastError 时允许 Push', () => {
      const draft = draftFixture({
        status: 'error',
        syncStatus: 'dirty',
        pendingOperation: 'push',
        lastError,
      })
      expect(syncActionDisabledReason(draft, 'push')).toBe('')
    })

    it('status=syncing 时仍禁止 Push', () => {
      const draft = draftFixture({
        status: 'syncing',
        syncStatus: 'clean',
        pendingOperation: 'push',
        lastError,
      })
      expect(syncActionDisabledReason(draft, 'push')).toBe('当前草稿正在同步处理中')
    })

    it('syncStatus=merge_conflict 时仍禁止 Push', () => {
      const draft = draftFixture({
        status: 'active',
        syncStatus: 'merge_conflict',
        pendingOperation: 'push',
        lastError,
      })
      expect(syncActionDisabledReason(draft, 'push')).toBe('合并冲突处理中')
    })

    it('syncStatus=awaiting_user 时仍禁止 Push', () => {
      const draft = draftFixture({
        status: 'active',
        syncStatus: 'awaiting_user',
        pendingOperation: 'push',
        lastError,
      })
      expect(syncActionDisabledReason(draft, 'push')).toBe('等待用户输入决定后才能继续 Pull 或 Push')
    })

    it('status=error 且 syncStatus=awaiting_user 时仍禁止 Push', () => {
      const draft = draftFixture({
        status: 'error',
        syncStatus: 'awaiting_user',
        pendingOperation: 'push',
        lastError,
      })
      expect(syncActionDisabledReason(draft, 'push')).toBe('等待用户输入决定后才能继续 Pull 或 Push')
    })
  })

  describe('syncActionDisabledReason：error 后可重试 Pull', () => {
    const lastError = '远端请求失败: connect ECONNREFUSED 127.0.0.1:8792'

    it('status=error、syncStatus=clean、pendingOperation=pull、有 lastError 时允许 Pull', () => {
      const draft = draftFixture({
        status: 'error',
        syncStatus: 'clean',
        pendingOperation: 'pull',
        lastError,
      })
      expect(syncActionDisabledReason(draft, 'pull')).toBe('')
    })

    it('status=error、syncStatus=dirty、pendingOperation=pull、有 lastError 时允许 Pull', () => {
      const draft = draftFixture({
        status: 'error',
        syncStatus: 'dirty',
        pendingOperation: 'pull',
        lastError,
      })
      expect(syncActionDisabledReason(draft, 'pull')).toBe('')
    })

    it('Pull 可重试失败草稿在 Push 上仍按 pendingOperation 禁止（Push GREEN 不变）', () => {
      const draft = draftFixture({
        status: 'error',
        syncStatus: 'clean',
        pendingOperation: 'pull',
        lastError,
      })
      expect(syncActionDisabledReason(draft, 'push')).toBe(`同步失败：${lastError}`)
    })

    it('status=syncing 时仍禁止 Pull', () => {
      const draft = draftFixture({
        status: 'syncing',
        syncStatus: 'clean',
        pendingOperation: 'pull',
        lastError,
      })
      expect(syncActionDisabledReason(draft, 'pull')).toBe('当前草稿正在同步处理中')
    })

    it('syncStatus=merge_conflict 时仍禁止 Pull', () => {
      const draft = draftFixture({
        status: 'active',
        syncStatus: 'merge_conflict',
        pendingOperation: 'pull',
        lastError,
      })
      expect(syncActionDisabledReason(draft, 'pull')).toBe('合并冲突处理中')
    })

    it('syncStatus=awaiting_user 时仍禁止 Pull', () => {
      const draft = draftFixture({
        status: 'active',
        syncStatus: 'awaiting_user',
        pendingOperation: 'pull',
        lastError,
      })
      expect(syncActionDisabledReason(draft, 'pull')).toBe('等待用户输入决定后才能继续 Pull 或 Push')
    })

    it('status=error 且 syncStatus=awaiting_user 时仍禁止 Pull', () => {
      const draft = draftFixture({
        status: 'error',
        syncStatus: 'awaiting_user',
        pendingOperation: 'pull',
        lastError,
      })
      expect(syncActionDisabledReason(draft, 'pull')).toBe('等待用户输入决定后才能继续 Pull 或 Push')
    })
  })

  it('Push 成功文案仅在 active 状态给出', () => {
    const activeDraft: SiteDraft = {
      draftId: 'd1',
      siteId: 's1',
      name: 'Test',
      settings: emptySettings,
      sandboxId: 's1',
      baseCommitId: 'a',
      headCommitId: 'b',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    }
    expect(pushSuccessMessage(activeDraft, 'https://example.com/')).toContain('https://example.com/')
    expect(
      pushSuccessMessage({ ...activeDraft, status: 'conflict' }, 'https://example.com/'),
    ).toBe('')
  })
})
