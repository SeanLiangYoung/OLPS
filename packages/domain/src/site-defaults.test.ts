import { describe, expect, it } from 'vitest'
import { requiredPages } from './required-pages.js'
import {
  createDefaultSiteContent,
  defaultManagedSiteSettings,
  validateSiteContent,
  type DefaultSiteContent,
} from './site-defaults.js'
import { validateSchema } from './validate.js'

function cloneContent(content: DefaultSiteContent): DefaultSiteContent {
  return structuredClone(content)
}

describe('defaultManagedSiteSettings', () => {
  it('默认启用 en 与 zh-CN，默认语言为 en，禁止 AI training', () => {
    const settings = defaultManagedSiteSettings()
    expect(settings.defaultLocale).toBe('en')
    expect(settings.locales.map((locale) => locale.code)).toEqual(['en', 'zh-CN'])
    expect(settings.search.allowAiTraining).toBe(false)
    expect(validateSchema('site-settings', settings).valid).toBe(true)
  })
})

describe('createDefaultSiteContent', () => {
  it('生成完整默认可校验内容', () => {
    const content = createDefaultSiteContent()
    const locales = content.settings.locales.map((locale) => locale.code)

    expect(locales).toEqual(['en', 'zh-CN'])
    expect(content.pages).toHaveLength(8)
    expect(content.collections).toHaveLength(3)
    expect(content.appearance.themeId).toBe('starter')
    expect(content.plugins.plugins['inquiry-form']?.enabled).toBe(true)
    expect(content.plugins.plugins.whatsapp?.enabled).toBe(true)
    expect(content.plugins.plugins['google-maps']?.enabled).toBe(true)

    let localeFileCount = 0
    for (const page of content.pages) {
      for (const locale of locales) {
        const localeFile = page.locales[locale]
        expect(localeFile).toBeDefined()
        expect(localeFile.blocks.length).toBeGreaterThanOrEqual(1)
        localeFileCount += 1
      }
    }
    expect(localeFileCount).toBe(16)

    const contact = content.pages.find((page) => page.meta.role === 'contact')
    expect(contact).toBeDefined()
    for (const locale of locales) {
      const blockTypes = contact!.locales[locale].blocks.map((block) => block.type)
      expect(blockTypes).toContain('plugin/inquiry-form/form')
      expect(blockTypes).toContain('plugin/google-maps/map')
      expect(blockTypes).toContain('plugin/whatsapp/button')
    }

    expect(content.collections.map((collection) => collection.prefix).sort()).toEqual([
      'news',
      'products',
      'solutions',
    ])

    expect(validateSchema('appearance', content.appearance).valid).toBe(true)
    expect(validateSchema('plugins', content.plugins).valid).toBe(true)
    for (const page of content.pages) {
      expect(validateSchema('page-meta', page.meta).valid).toBe(true)
      for (const localeFile of Object.values(page.locales)) {
        expect(
          validateSchema('page-locale', localeFile, { pageRole: page.meta.role }).valid,
        ).toBe(true)
      }
    }
    for (const collection of content.collections) {
      expect(validateSchema('collection', collection).valid).toBe(true)
    }

    const validation = validateSiteContent(content)
    expect(validation.valid).toBe(true)
    expect(validation.errors).toEqual([])
  })

  it('两次生成结果一致，便于作为可复现 fixture', () => {
    expect(createDefaultSiteContent()).toEqual(createDefaultSiteContent())
  })
})

describe('validateSiteContent', () => {
  it('成功路径检查角色唯一、默认语言与引用完整', () => {
    const content = createDefaultSiteContent()
    const result = validateSiteContent(content)
    expect(result.valid).toBe(true)

    const roles = content.pages.map((page) => page.meta.role)
    expect(new Set(roles).size).toBe(requiredPages.length)
    expect(
      content.settings.locales.some((locale) => locale.code === content.settings.defaultLocale),
    ).toBe(true)
  })

  it('缺页面时返回含对象路径的错误', () => {
    const content = cloneContent(createDefaultSiteContent())
    content.pages = content.pages.filter((page) => page.meta.role !== 'about')
    const result = validateSiteContent(content)
    expect(result.valid).toBe(false)
    const error = result.errors.find((item) => item.message.includes('about'))
    expect(error).toBeDefined()
    expect(error!.objectPath.length).toBeGreaterThan(0)
  })

  it('重复角色时返回含对象路径的错误', () => {
    const content = cloneContent(createDefaultSiteContent())
    const home = content.pages.find((page) => page.meta.role === 'home')!
    const about = content.pages.find((page) => page.meta.role === 'about')!
    about.meta.role = 'home'
    const result = validateSiteContent(content)
    expect(result.valid).toBe(false)
    const error = result.errors.find((item) => item.objectPath.includes(about.meta.pageId))
    expect(error).toBeDefined()
    expect(error!.message.toLowerCase()).toMatch(/role|角色|duplicate|重复/)
    expect(home.meta.role).toBe('home')
  })

  it('空区块时返回含对象路径的错误', () => {
    const content = cloneContent(createDefaultSiteContent())
    const page = content.pages.find((item) => item.meta.role === 'privacy')!
    page.locales.en.blocks = []
    const result = validateSiteContent(content)
    expect(result.valid).toBe(false)
    const error = result.errors.find((item) => item.objectPath.includes('/blocks'))
    expect(error).toBeDefined()
    expect(error!.objectPath).toContain(page.meta.pageId)
    expect(error!.objectPath).toContain('en')
  })

  it('失效媒体时返回含对象路径的错误', () => {
    const content = cloneContent(createDefaultSiteContent())
    const page = content.pages.find((item) => item.meta.role === 'home')!
    page.locales.en.cover = { mediaId: 'missing-media-id' }
    const result = validateSiteContent(content)
    expect(result.valid).toBe(false)
    const error = result.errors.find((item) => item.objectPath.includes('cover'))
    expect(error).toBeDefined()
    expect(error!.objectPath).toContain(page.meta.pageId)
    expect(error!.message.toLowerCase()).toMatch(/media|媒体/)
  })
})
