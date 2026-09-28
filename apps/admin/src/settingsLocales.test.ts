import { describe, expect, it } from 'vitest'
import { buildDraftSettingsForSave } from './settingsLocales'
import type { SiteSettings } from './types'

const base: SiteSettings = {
  defaultLocale: 'zh',
  locales: ['zh', 'en'],
  screenCap: 8,
  analyticsEnabled: false,
  mapsEnabled: false,
  mapsApiKey: '',
  whatsappEnabled: false,
  whatsappNumber: '',
  whatsappLabel: '',
}

describe('settingsLocales', () => {
  it('保存时保留用户填写的 defaultLocale，不强制为列表第一项', () => {
    const result = buildDraftSettingsForSave(base, 'en, zh')
    expect(result.defaultLocale).toBe('zh')
    expect(result.locales).toEqual(['en', 'zh'])
  })

  it('defaultLocale 不在语言列表时抛出错误', () => {
    expect(() =>
      buildDraftSettingsForSave({ ...base, defaultLocale: 'fr' }, 'en, zh'),
    ).toThrow('默认语言必须包含在语言列表中')
  })
})
