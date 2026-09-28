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
