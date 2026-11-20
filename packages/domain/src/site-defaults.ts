import type { AppearanceConfig, MenuItem } from './appearance.js'
import type { BlockNode } from './blocks.js'
import {
  collectionPresets,
  type CollectionPresetId,
} from './collection-presets.js'
import type {
  CollectionDefinition,
  ContentRef,
  FieldDefinition,
  PageLocaleFile,
  PageMeta,
  PageRole,
} from './content.js'
import { getLocaleDirection } from './locales.js'
import type { MediaMeta, MediaRef } from './media.js'
import type { PluginsConfig } from './plugins-config.js'
import { requiredPages } from './required-pages.js'
import type { ManagedSiteSettings } from './site-settings.js'
import type { ValidationErrorDetail, ValidationResult } from './validate.js'

const DEFAULT_TIMESTAMP = '2026-11-20T00:00:00.000Z'

const PAGE_IDS: Record<PageRole, string> = {
  home: '11111111-1111-4111-8111-111111111101',
  about: '11111111-1111-4111-8111-111111111102',
  contact: '11111111-1111-4111-8111-111111111103',
  privacy: '11111111-1111-4111-8111-111111111104',
  terms: '11111111-1111-4111-8111-111111111105',
  cookies: '11111111-1111-4111-8111-111111111106',
  'thank-you': '11111111-1111-4111-8111-111111111107',
  'not-found': '11111111-1111-4111-8111-111111111108',
}

const COLLECTION_IDS: Record<CollectionPresetId, string> = {
  news: '22222222-2222-4222-8222-222222222201',
  products: '22222222-2222-4222-8222-222222222202',
  solutions: '22222222-2222-4222-8222-222222222203',
}

const PRODUCT_LEVEL_IDS = {
  series: '33333333-3333-4333-8333-333333333301',
  category: '33333333-3333-4333-8333-333333333302',
} as const

const MENU_IDS = {
  home: '44444444-4444-4444-8444-444444444401',
  about: '44444444-4444-4444-8444-444444444402',
  contact: '44444444-4444-4444-8444-444444444403',
} as const

export type DefaultSitePage = {
  meta: PageMeta
  locales: Record<string, PageLocaleFile>
}

export type DefaultSiteContent = {
  settings: ManagedSiteSettings
  appearance: AppearanceConfig
  plugins: PluginsConfig
  pages: DefaultSitePage[]
  collections: CollectionDefinition[]
  media: MediaMeta[]
}

export function defaultManagedSiteSettings(
  overrides: Partial<ManagedSiteSettings> = {},
): ManagedSiteSettings {
  return {
    schemaVersion: 1,
    siteName: 'New Site',
    siteUrl: '',
    company: {
      name: '',
      address: '',
      phone: '',
      email: 'hello@example.com',
    },
    iconMediaId: null,
    socialLinks: [],
    locales: [
      { code: 'en', dir: getLocaleDirection('en') },
      { code: 'zh-CN', dir: getLocaleDirection('zh-CN') },
    ],
    defaultLocale: 'en',
    search: {
      allowIndexing: true,
      allowAiSearch: true,
      allowAiTraining: false,
    },
    ...overrides,
  }
}

function createBlock(id: string, type: string, props: Record<string, unknown> = {}): BlockNode {
  return {
    id,
    type,
    props,
    children: [],
  }
}

function pageIntroHtml(role: PageRole, locale: string): string {
  const titles: Record<PageRole, { en: string; 'zh-CN': string }> = {
    home: {
      en: '<p>Welcome to your new site.</p>',
      'zh-CN': '<p>欢迎来到你的新网站。</p>',
    },
    about: {
      en: '<p>Tell visitors about your company.</p>',
      'zh-CN': '<p>向访客介绍你的公司。</p>',
    },
    contact: {
      en: '<p>Get in touch with our team.</p>',
      'zh-CN': '<p>联系我们的团队。</p>',
    },
    privacy: {
      en: '<p>Describe how you handle personal data.</p>',
      'zh-CN': '<p>说明你如何处理个人数据。</p>',
    },
    terms: {
      en: '<p>Describe the terms of service.</p>',
      'zh-CN': '<p>说明服务条款。</p>',
    },
    cookies: {
      en: '<p>Describe how cookies are used.</p>',
      'zh-CN': '<p>说明 Cookie 的使用方式。</p>',
    },
    'thank-you': {
      en: '<p>Thank you. We received your inquiry.</p>',
      'zh-CN': '<p>感谢提交，我们已收到你的询盘。</p>',
    },
    'not-found': {
      en: '<p>The page you requested was not found.</p>',
      'zh-CN': '<p>你访问的页面不存在。</p>',
    },
  }
  return titles[role][locale === 'zh-CN' ? 'zh-CN' : 'en']
}

function createPageBlocks(role: PageRole, locale: string, pageId: string): BlockNode[] {
  const intro = createBlock(
    `${pageId}-${locale}-intro`,
    'core/html',
    { html: pageIntroHtml(role, locale) },
  )

  if (role !== 'contact') {
    return [intro]
  }

  return [
    intro,
    createBlock(`${pageId}-${locale}-inquiry`, 'plugin/inquiry-form/form', {}),
    createBlock(`${pageId}-${locale}-map`, 'plugin/google-maps/map', {}),
    createBlock(`${pageId}-${locale}-whatsapp`, 'plugin/whatsapp/button', {}),
  ]
}

function createPageLocale(
  role: PageRole,
  locale: string,
  pageId: string,
  title: string,
  slug: string,
): PageLocaleFile {
  return {
    schemaVersion: 1,
    locale,
    slug,
    title,
    summary: title,
    cover: null,
    seo: {
      title,
      description: title,
      ogImage: null,
    },
    blocks: createPageBlocks(role, locale, pageId),
    sourceHash: null,
    updatedAt: DEFAULT_TIMESTAMP,
  }
}

function createDefaultPages(): DefaultSitePage[] {
  return requiredPages.map((definition) => {
    const pageId = PAGE_IDS[definition.role]
    const meta: PageMeta = {
      schemaVersion: 1,
      pageId,
      role: definition.role,
      template: 'page',
      status: 'published',
      createdAt: DEFAULT_TIMESTAMP,
      updatedAt: DEFAULT_TIMESTAMP,
    }

    return {
      meta,
      locales: {
        en: createPageLocale(
          definition.role,
          'en',
          pageId,
          definition.name.en,
          definition.defaultSlug,
        ),
        'zh-CN': createPageLocale(
          definition.role,
          'zh-CN',
          pageId,
          definition.name['zh-CN'],
          definition.defaultSlug,
        ),
      },
    }
  })
}

function createCollectionFields(
  presetId: CollectionPresetId,
  collectionIds: Record<CollectionPresetId, string>,
): FieldDefinition[] {
  return collectionPresets[presetId].fields.map((field) => {
    const definition: FieldDefinition = {
      key: field.key,
      type: field.type,
      label: field.label,
      translatable: field.translatable,
      required: field.required,
    }
    if (field.options) {
      definition.options = field.options
    }
    if (field.columns) {
      definition.columns = field.columns
    }
    if (field.referencePreset) {
      definition.referenceCollectionId = collectionIds[field.referencePreset]
    }
    return definition
  })
}

function createDefaultCollections(): CollectionDefinition[] {
  const order: CollectionPresetId[] = ['news', 'products', 'solutions']
  return order.map((presetId) => {
    const preset = collectionPresets[presetId]
    const levels = presetId === 'products'
      ? [
          { levelId: PRODUCT_LEVEL_IDS.series, name: preset.levels[0]!.name },
          { levelId: PRODUCT_LEVEL_IDS.category, name: preset.levels[1]!.name },
        ]
      : []

    return {
      schemaVersion: 1,
      collectionId: COLLECTION_IDS[presetId],
      name: preset.name,
      labels: { ...preset.labels },
      prefix: preset.prefix,
      status: 'published',
      levels,
      fields: createCollectionFields(presetId, COLLECTION_IDS),
      structuredData: preset.structuredData,
      feed: preset.feed,
      createdAt: DEFAULT_TIMESTAMP,
      updatedAt: DEFAULT_TIMESTAMP,
    }
  })
}

function createDefaultMenus(pages: DefaultSitePage[]): Record<string, MenuItem[]> {
  const pageIdByRole = Object.fromEntries(
    pages.map((page) => [page.meta.role, page.meta.pageId]),
  ) as Record<PageRole, string>

  const item = (
    menuItemId: string,
    role: PageRole,
    label: { en: string; 'zh-CN': string },
  ): MenuItem => ({
    menuItemId,
    label,
    link: {
      kind: 'internal',
      target: { ref: 'page', id: pageIdByRole[role] },
    },
    children: [],
  })

  return {
    primary: [
      item(MENU_IDS.home, 'home', { en: 'Home', 'zh-CN': '首页' }),
      item(MENU_IDS.about, 'about', { en: 'About', 'zh-CN': '关于我们' }),
      item(MENU_IDS.contact, 'contact', { en: 'Contact', 'zh-CN': '联系我们' }),
    ],
  }
}

export function createDefaultSiteContent(
  settingsOverrides: Partial<ManagedSiteSettings> = {},
): DefaultSiteContent {
  const settings = defaultManagedSiteSettings(settingsOverrides)
  const pages = createDefaultPages()
  const collections = createDefaultCollections()

  return {
    settings,
    appearance: {
      schemaVersion: 1,
      themeId: 'starter',
      themeSettings: {},
      menus: createDefaultMenus(pages),
    },
    plugins: {
      schemaVersion: 1,
      plugins: {
        'inquiry-form': {
          enabled: true,
          permissionsAcceptedAt: null,
          permissionsAcceptedBy: null,
          settings: {},
        },
        whatsapp: {
          enabled: true,
          permissionsAcceptedAt: null,
          permissionsAcceptedBy: null,
          settings: {},
        },
        'google-maps': {
          enabled: true,
          permissionsAcceptedAt: null,
          permissionsAcceptedBy: null,
          settings: {},
        },
      },
    },
    pages,
    collections,
    media: [],
  }
}

function pushError(
  errors: ValidationErrorDetail[],
  objectPath: string,
  message: string,
): void {
  errors.push({
    objectPath,
    schemaPath: '',
    message,
  })
}

function collectMediaIds(media: MediaMeta[]): Set<string> {
  return new Set(media.map((item) => item.mediaId))
}

function collectPageIds(pages: DefaultSitePage[]): Set<string> {
  return new Set(pages.map((page) => page.meta.pageId))
}

function collectCollectionIds(collections: CollectionDefinition[]): Set<string> {
  return new Set(collections.map((collection) => collection.collectionId))
}

function validateMediaRef(
  errors: ValidationErrorDetail[],
  objectPath: string,
  mediaRef: MediaRef | null | undefined,
  mediaIds: Set<string>,
): void {
  if (!mediaRef) {
    return
  }
  if (!mediaIds.has(mediaRef.mediaId)) {
    pushError(errors, objectPath, `媒体引用无效：${mediaRef.mediaId}`)
  }
}

function validateContentRef(
  errors: ValidationErrorDetail[],
  objectPath: string,
  ref: ContentRef,
  pageIds: Set<string>,
  collectionIds: Set<string>,
): void {
  if (ref.ref === 'page') {
    if (!pageIds.has(ref.id)) {
      pushError(errors, objectPath, `页面引用无效：${ref.id}`)
    }
    return
  }
  if (ref.ref === 'collection') {
    if (!collectionIds.has(ref.id)) {
      pushError(errors, objectPath, `内容类型引用无效：${ref.id}`)
    }
    return
  }
  pushError(errors, objectPath, `站内引用缺少目标对象：${ref.ref}/${ref.id}`)
}

function walkBlocks(
  errors: ValidationErrorDetail[],
  objectPath: string,
  blocks: BlockNode[],
  mediaIds: Set<string>,
  pageIds: Set<string>,
  collectionIds: Set<string>,
): void {
  blocks.forEach((block, index) => {
    const blockPath = `${objectPath}/${index}`
    for (const [key, value] of Object.entries(block.props)) {
      inspectUnknownValue(
        errors,
        `${blockPath}/props/${key}`,
        value,
        mediaIds,
        pageIds,
        collectionIds,
      )
    }
    walkBlocks(
      errors,
      `${blockPath}/children`,
      block.children,
      mediaIds,
      pageIds,
      collectionIds,
    )
  })
}

function inspectUnknownValue(
  errors: ValidationErrorDetail[],
  objectPath: string,
  value: unknown,
  mediaIds: Set<string>,
  pageIds: Set<string>,
  collectionIds: Set<string>,
): void {
  if (value === null || value === undefined) {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      inspectUnknownValue(
        errors,
        `${objectPath}/${index}`,
        item,
        mediaIds,
        pageIds,
        collectionIds,
      )
    })
    return
  }
  if (typeof value !== 'object') {
    return
  }

  const record = value as Record<string, unknown>
  if (typeof record.mediaId === 'string' && Object.keys(record).length === 1) {
    validateMediaRef(errors, objectPath, { mediaId: record.mediaId }, mediaIds)
    return
  }
  if (
    record.kind === 'internal'
    && record.target
    && typeof record.target === 'object'
    && record.target !== null
  ) {
    const target = record.target as ContentRef
    if (typeof target.ref === 'string' && typeof target.id === 'string') {
      validateContentRef(errors, `${objectPath}/target`, target, pageIds, collectionIds)
    }
    return
  }
  if (typeof record.ref === 'string' && typeof record.id === 'string') {
    validateContentRef(errors, objectPath, record as ContentRef, pageIds, collectionIds)
    return
  }

  for (const [key, nested] of Object.entries(record)) {
    inspectUnknownValue(
      errors,
      `${objectPath}/${key}`,
      nested,
      mediaIds,
      pageIds,
      collectionIds,
    )
  }
}

export function validateSiteContent(content: DefaultSiteContent): ValidationResult {
  const errors: ValidationErrorDetail[] = []
  const locales = content.settings.locales.map((locale) => locale.code)
  const mediaIds = collectMediaIds(content.media)
  const pageIds = collectPageIds(content.pages)
  const collectionIds = collectCollectionIds(content.collections)

  if (!locales.includes(content.settings.defaultLocale)) {
    pushError(
      errors,
      '/settings/defaultLocale',
      `默认语言不在语言列表中：${content.settings.defaultLocale}`,
    )
  }

  if (content.settings.iconMediaId !== null && !mediaIds.has(content.settings.iconMediaId)) {
    pushError(
      errors,
      '/settings/iconMediaId',
      `媒体引用无效：${content.settings.iconMediaId}`,
    )
  }

  const requiredPrefixes = ['news', 'products', 'solutions'] as const
  for (const prefix of requiredPrefixes) {
    if (!content.collections.some((collection) => collection.prefix === prefix)) {
      pushError(errors, '/collections', `缺少内容类型定义：${prefix}`)
    }
  }

  for (const locale of locales) {
    for (const definition of requiredPages) {
      const matches = content.pages.filter((page) => {
        return page.meta.role === definition.role && page.locales[locale] !== undefined
      })
      if (matches.length === 0) {
        pushError(
          errors,
          '/pages',
          `缺少必备页面语言文件：role=${definition.role}, locale=${locale}`,
        )
      }
    }
  }

  const rolesByLocale = new Map<string, Map<PageRole, string[]>>()
  for (const page of content.pages) {
    const pagePath = `/pages/${page.meta.pageId}`
    if (page.meta.role === null) {
      continue
    }

    for (const locale of Object.keys(page.locales)) {
      const localeMap = rolesByLocale.get(locale) ?? new Map<PageRole, string[]>()
      const pageIdList = localeMap.get(page.meta.role) ?? []
      pageIdList.push(page.meta.pageId)
      localeMap.set(page.meta.role, pageIdList)
      rolesByLocale.set(locale, localeMap)

      const localeFile = page.locales[locale]
      const localePath = `${pagePath}/locales/${locale}`
      if (localeFile.blocks.length === 0) {
        pushError(errors, `${localePath}/blocks`, '页面区块不能为空')
      }

      validateMediaRef(errors, `${localePath}/cover`, localeFile.cover, mediaIds)
      validateMediaRef(errors, `${localePath}/seo/ogImage`, localeFile.seo.ogImage, mediaIds)
      walkBlocks(
        errors,
        `${localePath}/blocks`,
        localeFile.blocks,
        mediaIds,
        pageIds,
        collectionIds,
      )
    }
  }

  for (const [locale, roleMap] of rolesByLocale) {
    for (const [role, pageIdList] of roleMap) {
      if (pageIdList.length > 1) {
        for (const pageId of pageIdList) {
          pushError(
            errors,
            `/pages/${pageId}/meta/role`,
            `角色重复：role=${role}, locale=${locale}`,
          )
        }
      }
    }
  }

  for (const [menuName, items] of Object.entries(content.appearance.menus)) {
    inspectUnknownValue(
      errors,
      `/appearance/menus/${menuName}`,
      items,
      mediaIds,
      pageIds,
      collectionIds,
    )
  }

  for (const collection of content.collections) {
    for (const field of collection.fields) {
      if (field.type === 'reference' && field.referenceCollectionId) {
        if (!collectionIds.has(field.referenceCollectionId)) {
          pushError(
            errors,
            `/collections/${collection.collectionId}/fields/${field.key}/referenceCollectionId`,
            `内容类型引用无效：${field.referenceCollectionId}`,
          )
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }
  return { valid: true, errors: [] }
}
