import { describe, expect, it } from 'vitest'
import { I18nLookupError, loadPackageStrings, lookupI18nString } from './i18n.js'
import { createNodeSourceReader } from './test-support/node-source-reader.js'
import { fullSiteFixtureRoot } from './test-support/paths.js'
import { loadSiteModel } from './site-model.js'

describe('i18n 固定文字查找', () => {
  it('优先使用 source/i18n 覆盖主题文字', async () => {
    const reader = createNodeSourceReader(fullSiteFixtureRoot)
    const model = await loadSiteModel(reader)
    const packages = await loadPackageStrings(reader, {
      themeId: 'starter',
      enabledPluginIds: [],
    })
    const siteStrings = {
      ...(model.i18n.en?.strings ?? {}),
      'theme:starter:read_more': 'Site override read more',
    }
    const text = lookupI18nString({
      locale: 'en',
      key: 'read_more',
      siteStrings,
      themeId: 'starter',
      enabledPluginIds: [],
      packages,
    })
    expect(text).toBe('Site override read more')
  })

  it('缺少翻译时抛出含语言、来源、键名的错误', async () => {
    const reader = createNodeSourceReader(fullSiteFixtureRoot)
    const packages = await loadPackageStrings(reader, {
      themeId: 'starter',
      enabledPluginIds: [],
    })
    expect(() =>
      lookupI18nString({
        locale: 'en',
        key: 'missing_key',
        siteStrings: {},
        themeId: 'starter',
        enabledPluginIds: [],
        packages,
      }),
    ).toThrow(I18nLookupError)

    try {
      lookupI18nString({
        locale: 'en',
        key: 'missing_key',
        siteStrings: {},
        themeId: 'starter',
        enabledPluginIds: [],
        packages,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(I18nLookupError)
      const lookupError = error as I18nLookupError
      expect(lookupError.locale).toBe('en')
      expect(lookupError.source).toContain('theme:starter')
      expect(lookupError.key).toBe('missing_key')
      expect(lookupError.message).toContain('en')
      expect(lookupError.message).toContain('missing_key')
      expect(lookupError.message).toContain('theme:starter')
    }
  })
})
