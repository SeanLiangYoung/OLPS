import { describe, expect, it } from 'vitest'
import {
  SchemaValidationError,
  assertValidSchema,
  schemaNames,
  validateSchema,
} from './index.js'

const id = '17fa1c4f-cf9e-44d4-aa77-5e8366a55097'
const secondId = '28acddaf-d7bd-4057-b25e-766a1e973a5f'
const dateTime = '2026-11-20T02:30:00.000Z'

const seo = {
  title: 'Example',
  description: 'Example description',
  ogImage: null,
}

const block = {
  id,
  type: 'core/html',
  props: { html: '<p>Example</p>' },
  children: [],
}

const localeContent = {
  schemaVersion: 1,
  locale: 'en',
  title: 'Example',
  summary: 'Example summary',
  cover: null,
  seo,
  blocks: [block],
  sourceHash: null,
  updatedAt: dateTime,
}

const baseField = {
  key: 'model',
  type: 'text',
  label: 'Model',
  translatable: false,
  required: true,
}

const blockField = {
  key: 'heading',
  type: 'text',
  label: 'Heading',
  required: true,
  translatable: true,
}

const validDocuments = {
  'site-settings': {
    schemaVersion: 1,
    siteName: 'Example',
    siteUrl: 'https://example.com',
    company: {
      name: 'Example Ltd.',
      address: '1 Example Road',
      phone: '+1-555-0100',
      email: 'hello@example.com',
    },
    iconMediaId: null,
    socialLinks: [{ platform: 'linkedin', url: 'https://linkedin.com/company/example' }],
    locales: [{ code: 'en', dir: 'ltr' }],
    defaultLocale: 'en',
    search: {
      allowIndexing: true,
      allowAiSearch: true,
      allowAiTraining: false,
    },
  },
  'publish-config': {
    schemaVersion: 1,
    siteId: id,
    publicSiteUrl: 'https://example.com',
    publicApiBaseUrl: 'https://api.example.com',
    hostingBasePath: '/',
    connectors: {
      ga4: { measurementId: 'G-ABC123' },
      googleAds: { conversionId: 'AW-123456', conversionLabel: 'AbCdEf' },
      meta: { pixelId: '123456789' },
    },
    conversionSettings: {
      submitInquiry: true,
      qualifiedInquiry: true,
    },
    indexNowKey: 'index-now-key',
  },
  appearance: {
    schemaVersion: 1,
    themeId: 'starter',
    themeSettings: { primaryColor: '#14532d' },
    menus: {
      primary: [{
        menuItemId: id,
        label: { en: 'Home' },
        link: { kind: 'internal', target: { ref: 'page', id } },
        children: [],
      }],
    },
  },
  plugins: {
    schemaVersion: 1,
    plugins: {
      'inquiry-form': {
        enabled: true,
        permissionsAcceptedAt: dateTime,
        permissionsAcceptedBy: id,
        settings: { requirePrivacyConsent: true },
      },
    },
  },
  redirects: {
    schemaVersion: 1,
    redirects: [{
      redirectId: id,
      locale: 'en',
      from: '/en/old-contact/',
      target: { ref: 'page', id: secondId },
      createdAt: dateTime,
    }],
  },
  'page-meta': {
    schemaVersion: 1,
    pageId: id,
    role: 'contact',
    template: 'page',
    status: 'published',
    createdAt: dateTime,
    updatedAt: dateTime,
  },
  'page-locale': {
    ...localeContent,
    slug: 'contact',
  },
  collection: {
    schemaVersion: 1,
    collectionId: id,
    name: 'Products',
    labels: { en: 'Products' },
    prefix: 'products',
    status: 'published',
    levels: [{ levelId: secondId, name: 'Category' }],
    fields: [baseField],
    structuredData: 'Product',
    feed: false,
    createdAt: dateTime,
    updatedAt: dateTime,
  },
  'collection-index-locale': localeContent,
  'group-meta': {
    schemaVersion: 1,
    groupId: id,
    parentGroupId: null,
    levelId: secondId,
    order: 10,
    status: 'published',
    createdAt: dateTime,
    updatedAt: dateTime,
  },
  'group-locale': {
    ...localeContent,
    slug: 'category',
  },
  'item-meta': {
    schemaVersion: 1,
    itemId: id,
    primaryGroupId: secondId,
    groupIds: [secondId],
    order: 10,
    publishedAt: dateTime,
    status: 'published',
    fields: { model: 'EXAMPLE-100' },
    createdAt: dateTime,
    updatedAt: dateTime,
  },
  'item-locale': {
    ...localeContent,
    slug: 'example-100',
    fields: { specifications: [{ name: 'Length', value: 100 }] },
  },
  media: {
    schemaVersion: 1,
    mediaId: id,
    path: 'assets/uploads/2026/11/example.webp',
    mimeType: 'image/webp',
    size: 183402,
    width: 1600,
    height: 900,
    title: { en: 'Example image' },
    alt: { en: 'Example image' },
    caption: { en: '' },
    uploadedBy: secondId,
    uploadedAt: dateTime,
    updatedAt: dateTime,
  },
  i18n: {
    schemaVersion: 1,
    strings: {
      'theme:starter:read_more': 'Read more',
      'plugin:inquiry-form:submit': 'Send inquiry',
    },
  },
  theme: {
    schemaVersion: 1,
    id: 'starter',
    name: 'Starter',
    version: '1.0.0',
    author: 'OLPS',
    description: 'Starter theme',
    requires: '1',
    settings: [blockField],
    menus: [{ id: 'primary', name: 'Primary navigation' }],
    templates: [{ id: 'full-width', name: 'Full width' }],
    styles: ['assets/theme.css'],
  },
  plugin: {
    schemaVersion: 1,
    id: 'inquiry-form',
    name: 'Inquiry form',
    version: '1.0.0',
    author: 'OLPS',
    description: 'Inquiry form plugin',
    requires: '1',
    settings: [{ ...blockField, type: 'secret' }],
    snippets: [{ file: 'snippets/form.liquid', position: 'body-end', scope: 'pages-with-block' }],
    assets: ['assets/form.js'],
    server: { build: 'server/build.js', api: 'server/api.js' },
    permissions: { store: true, inquiries: true, fetch: ['api.example.com'] },
  },
  section: {
    schemaVersion: 1,
    name: 'Hero',
    description: 'Hero section',
    category: 'Hero',
    fields: [blockField],
    accepts: [],
    preview: { heading: 'Example' },
  },
  manifest: {
    schemaVersion: 1,
    verifyCommand: ['node', 'tools/site-verify.mjs'],
  },
} as const

type SchemaName = keyof typeof validDocuments

const requiredFieldBySchema: Record<SchemaName, string> = {
  'site-settings': 'siteName',
  'publish-config': 'siteId',
  appearance: 'themeId',
  plugins: 'plugins',
  redirects: 'redirects',
  'page-meta': 'pageId',
  'page-locale': 'locale',
  collection: 'collectionId',
  'collection-index-locale': 'locale',
  'group-meta': 'groupId',
  'group-locale': 'locale',
  'item-meta': 'itemId',
  'item-locale': 'locale',
  media: 'mediaId',
  i18n: 'strings',
  theme: 'id',
  plugin: 'id',
  section: 'name',
  manifest: 'verifyCommand',
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

describe('JSON Schema 基础验证', () => {
  it.each([
    ['http://127.0.0.1:8787', true],
    ['http://localhost:8787/subsite', true],
    ['http://[::1]:8787', true],
    ['http://example.com', false],
    ['http://localhost.example.com', false],
    ['http://localhost@evil.example', false],
  ])('本地开发地址校验 %s', (url, allowed) => {
    const settings = clone(validDocuments['site-settings']) as Record<string, unknown>
    settings.siteUrl = url
    const publish = clone(validDocuments['publish-config']) as Record<string, unknown>
    publish.publicSiteUrl = url
    publish.publicApiBaseUrl = url
    expect(validateSchema('site-settings', settings).valid).toBe(allowed)
    expect(validateSchema('publish-config', publish).valid).toBe(allowed)
  })
  it('公开全部 19 个 Schema', () => {
    expect(schemaNames).toEqual(Object.keys(validDocuments))
  })

  for (const [schemaName, document] of Object.entries(validDocuments) as Array<[SchemaName, unknown]>) {
    it(`${schemaName} 接受合法文件`, () => {
      expect(validateSchema(schemaName, clone(document))).toEqual({ valid: true, errors: [] })
    })

    it(`${schemaName} 拒绝缺少必填字段`, () => {
      const invalid = clone(document) as Record<string, unknown>
      delete invalid[requiredFieldBySchema[schemaName]]

      expect(validateSchema(schemaName, invalid).valid).toBe(false)
    })

    it(`${schemaName} 拒绝额外字段`, () => {
      const invalid = { ...(clone(document) as Record<string, unknown>), unexpected: true }

      expect(validateSchema(schemaName, invalid).valid).toBe(false)
    })
  }
})

describe('跨字段规则', () => {
  it('要求 defaultLocale 出现在 locales 中', () => {
    const document = clone(validDocuments['site-settings'])
    document.defaultLocale = 'zh-CN'
    expect(validateSchema('site-settings', document).valid).toBe(false)
  })

  it('要求 home 页面的 slug 为空字符串', () => {
    const meta = { ...clone(validDocuments['page-meta']), role: 'home' as const }
    const document = { ...clone(validDocuments['page-locale']), slug: 'home' }
    expect(validateSchema('page-locale', document, { pageRole: meta.role }).valid).toBe(false)
  })

  it('要求 select 字段提供非空 options', () => {
    const document = clone(validDocuments.collection)
    document.fields = [{ ...baseField, type: 'select' }] as typeof document.fields
    expect(validateSchema('collection', document).valid).toBe(false)
  })

  it('要求 table 字段提供非空 columns', () => {
    const document = clone(validDocuments.collection)
    document.fields = [{ ...baseField, type: 'table' }] as typeof document.fields
    expect(validateSchema('collection', document).valid).toBe(false)
  })

  it('要求 reference 字段提供 referenceCollectionId', () => {
    const document = clone(validDocuments.collection)
    document.fields = [{ ...baseField, type: 'reference' }] as typeof document.fields
    expect(validateSchema('collection', document).valid).toBe(false)
  })

  it('要求 primaryGroupId 出现在 groupIds 中', () => {
    const document = clone(validDocuments['item-meta'])
    document.groupIds = []
    expect(validateSchema('item-meta', document).valid).toBe(false)
  })

  it('要求无分组条目的 primaryGroupId 和 groupIds 同时为空', () => {
    const document = clone(validDocuments['item-meta'])
    document.primaryGroupId = null
    expect(validateSchema('item-meta', document).valid).toBe(false)
  })

  it('要求图片提供 width 和 height', () => {
    const document = clone(validDocuments.media)
    document.width = null
    expect(validateSchema('media', document).valid).toBe(false)
  })

  it('要求插件权限确认时间与确认人同时存在', () => {
    const document = clone(validDocuments.plugins)
    document.plugins['inquiry-form'].permissionsAcceptedBy = null
    expect(validateSchema('plugins', document).valid).toBe(false)
  })

  it('要求 list 区块字段提供非空 itemFields', () => {
    const document = clone(validDocuments.section)
    document.fields = [{ ...blockField, type: 'list' }] as typeof document.fields
    expect(validateSchema('section', document).valid).toBe(false)
  })
})
describe('验证错误', () => {
  it('返回对象路径、Schema 路径和可读消息', () => {
    const document = clone(validDocuments['site-settings'])
    document.company.email = 'invalid'
    const result = validateSchema('site-settings', document)

    expect(result.valid).toBe(false)
    expect(result.errors[0]).toEqual(expect.objectContaining({
      objectPath: '/company/email',
      schemaPath: expect.stringContaining('/properties/company/'),
      message: expect.any(String),
    }))
    expect(result.errors[0]?.message.length).toBeGreaterThan(0)
  })

  it('assertValidSchema 抛出结构化错误并保留文件路径', () => {
    const document = clone(validDocuments.manifest) as Record<string, unknown>
    delete document.verifyCommand

    expect(() => assertValidSchema('manifest', document, 'olps.manifest.json')).toThrow(
      expect.objectContaining({
        name: 'SchemaValidationError',
        filePath: 'olps.manifest.json',
        schemaName: 'manifest',
        errors: expect.arrayContaining([
          expect.objectContaining({
            objectPath: expect.any(String),
            schemaPath: expect.any(String),
            message: expect.any(String),
          }),
        ]),
      }),
    )
    expect(() => assertValidSchema('manifest', document)).toThrow(SchemaValidationError)
  })
})
