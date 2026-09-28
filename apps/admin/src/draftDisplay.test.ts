import { describe, expect, it } from 'vitest'
import {
  draftStatusLabel,
  formatCommitRef,
  syncActionDisabledReason,
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
  it('映射草稿状态为界面文案', () => {
    expect(draftStatusLabel('ready')).toBe('就绪')
    expect(draftStatusLabel('syncing')).toBe('同步处理中')
    expect(draftStatusLabel('conflict')).toBe('等待用户决定')
    expect(draftStatusLabel('error')).toBe('同步失败')
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
    expect(syncActionDisabledReason({ ...draft, status: 'ready' }, 'push')).toBe('')
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
})
