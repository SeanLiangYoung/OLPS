import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDefaultSiteContent } from '@olps/domain'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.join(__dirname, '..', 'test-fixtures', 'sites', 'full-site')
const TIMESTAMP = '2026-11-20T00:00:00.000Z'

const PRODUCTS_ID = '22222222-2222-4222-8222-222222222202'
const SERIES_LEVEL = '33333333-3333-4333-8333-333333333301'
const CATEGORY_LEVEL = '33333333-3333-4333-8333-333333333302'

const GROUP_IDS = {
  seriesAlpha: '55555555-5555-4555-8555-555555555501',
  seriesBeta: '55555555-5555-4555-8555-555555555502',
  catAlpha1: '55555555-5555-4555-8555-555555555503',
  catAlpha2: '55555555-5555-4555-8555-555555555504',
}

const ITEM_IDS = {
  pumpA: '66666666-6666-4666-8666-666666666601',
  pumpB: '66666666-6666-4666-8666-666666666602',
}

async function writeJson(relativePath, value) {
  const fullPath = path.join(fixtureRoot, relativePath)
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function listBlock(id) {
  return {
    id,
    type: 'core/collection-list',
    props: {
      source: 'current',
      pageSize: 24,
      sort: 'manual',
    },
    children: [],
  }
}

function localeShell({ locale, slug, title, blocks = [listBlock(`${slug}-${locale}-list`)] }) {
  return {
    schemaVersion: 1,
    locale,
    ...(slug !== undefined ? { slug } : {}),
    title,
    summary: title,
    cover: null,
    seo: {
      title,
      description: title,
      ogImage: null,
    },
    blocks,
    sourceHash: null,
    updatedAt: TIMESTAMP,
  }
}

async function writeGroup(meta, locales) {
  const base = `source/collections/${PRODUCTS_ID}/groups/${meta.groupId}`
  await writeJson(`${base}/group.json`, meta)
  for (const [locale, file] of Object.entries(locales)) {
    await writeJson(`${base}/${locale}.json`, file)
  }
}

async function writeItem(meta, locales) {
  const base = `source/collections/${PRODUCTS_ID}/items/${meta.itemId}`
  await writeJson(`${base}/item.json`, meta)
  for (const [locale, file] of Object.entries(locales)) {
    await writeJson(`${base}/${locale}.json`, file)
  }
}

const content = createDefaultSiteContent({
  siteName: 'Acme Manufacturing',
  siteUrl: 'https://www.example.com',
  company: {
    name: 'Acme Manufacturing Ltd.',
    address: '100 Industry Road',
    phone: '+1-555-0100',
    email: 'sales@example.com',
  },
})

await fs.rm(fixtureRoot, { recursive: true, force: true })
await fs.mkdir(fixtureRoot, { recursive: true })

await writeJson('olps.manifest.json', {
  schemaVersion: 1,
  verifyCommand: ['node', 'tools/site-verify.mjs'],
})

await writeJson('source/site-settings.json', content.settings)
await writeJson('source/appearance.json', content.appearance)
await writeJson('source/plugins.json', content.plugins)
await writeJson('source/redirects.json', {
  schemaVersion: 1,
  redirects: [],
})
await writeJson('source/publish-config.json', {
  schemaVersion: 1,
  siteId: '1f6a93e3-c058-4c98-b89c-a80a79ba4f11',
  publicSiteUrl: 'https://www.example.com',
  publicApiBaseUrl: 'https://api.example.com',
  hostingBasePath: '/',
  connectors: {},
  conversionSettings: {
    submitInquiry: true,
    qualifiedInquiry: true,
  },
  indexNowKey: '2f9d90a1aa414e60816a',
})

for (const page of content.pages) {
  const base = `source/pages/${page.meta.pageId}`
  await writeJson(`${base}/page.json`, page.meta)
  for (const [locale, file] of Object.entries(page.locales)) {
    await writeJson(`${base}/${locale}.json`, file)
  }
}

for (const collection of content.collections) {
  await writeJson(`source/collections/${collection.collectionId}.json`, collection)
  for (const locale of ['en', 'zh-CN']) {
    const title = collection.labels[locale] ?? collection.name
    await writeJson(
      `source/collections/${collection.collectionId}/index/${locale}.json`,
      localeShell({
        locale,
        title,
        blocks: [listBlock(`${collection.collectionId}-${locale}-index`)],
      }),
    )
  }
}

await writeGroup(
  {
    schemaVersion: 1,
    groupId: GROUP_IDS.seriesAlpha,
    parentGroupId: null,
    levelId: SERIES_LEVEL,
    order: 10,
    status: 'published',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
  {
    en: localeShell({ locale: 'en', slug: 'series-alpha', title: 'Series Alpha' }),
    'zh-CN': localeShell({ locale: 'zh-CN', slug: 'series-alpha', title: '系列甲' }),
  },
)

await writeGroup(
  {
    schemaVersion: 1,
    groupId: GROUP_IDS.seriesBeta,
    parentGroupId: null,
    levelId: SERIES_LEVEL,
    order: 20,
    status: 'published',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
  {
    en: localeShell({ locale: 'en', slug: 'series-beta', title: 'Series Beta' }),
    'zh-CN': localeShell({ locale: 'zh-CN', slug: 'series-beta', title: '系列乙' }),
  },
)

await writeGroup(
  {
    schemaVersion: 1,
    groupId: GROUP_IDS.catAlpha1,
    parentGroupId: GROUP_IDS.seriesAlpha,
    levelId: CATEGORY_LEVEL,
    order: 10,
    status: 'published',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
  {
    en: localeShell({ locale: 'en', slug: 'cat-alpha-1', title: 'Category Alpha 1' }),
    'zh-CN': localeShell({ locale: 'zh-CN', slug: 'cat-alpha-1', title: '分类甲一' }),
  },
)

await writeGroup(
  {
    schemaVersion: 1,
    groupId: GROUP_IDS.catAlpha2,
    parentGroupId: GROUP_IDS.seriesAlpha,
    levelId: CATEGORY_LEVEL,
    order: 20,
    status: 'published',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
  {
    en: localeShell({ locale: 'en', slug: 'cat-alpha-2', title: 'Category Alpha 2' }),
    'zh-CN': localeShell({ locale: 'zh-CN', slug: 'cat-alpha-2', title: '分类甲二' }),
  },
)

await writeItem(
  {
    schemaVersion: 1,
    itemId: ITEM_IDS.pumpA,
    primaryGroupId: GROUP_IDS.catAlpha1,
    groupIds: [GROUP_IDS.catAlpha1, GROUP_IDS.catAlpha2],
    order: 10,
    publishedAt: TIMESTAMP,
    status: 'published',
    fields: {
      model: 'PUMP-A',
      gallery: [],
    },
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
  {
    en: {
      ...localeShell({
        locale: 'en',
        slug: 'pump-a',
        title: 'Pump A',
        blocks: [{
          id: 'pump-a-en-html',
          type: 'core/html',
          props: { html: '<p>Pump A</p>' },
          children: [],
        }],
      }),
      fields: {
        specifications: [{ name: 'Flow', value: '10 L/min' }],
      },
    },
    'zh-CN': {
      ...localeShell({
        locale: 'zh-CN',
        slug: 'pump-a',
        title: '水泵甲',
        blocks: [{
          id: 'pump-a-zh-html',
          type: 'core/html',
          props: { html: '<p>水泵甲</p>' },
          children: [],
        }],
      }),
      fields: {
        specifications: [{ name: '流量', value: '10 L/min' }],
      },
    },
  },
)

await writeItem(
  {
    schemaVersion: 1,
    itemId: ITEM_IDS.pumpB,
    primaryGroupId: GROUP_IDS.catAlpha2,
    groupIds: [GROUP_IDS.catAlpha1, GROUP_IDS.catAlpha2],
    order: 20,
    publishedAt: TIMESTAMP,
    status: 'published',
    fields: {
      model: 'PUMP-B',
      gallery: [],
    },
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
  {
    en: {
      ...localeShell({
        locale: 'en',
        slug: 'pump-b',
        title: 'Pump B',
        blocks: [{
          id: 'pump-b-en-html',
          type: 'core/html',
          props: { html: '<p>Pump B</p>' },
          children: [],
        }],
      }),
      fields: {
        specifications: [{ name: 'Flow', value: '20 L/min' }],
      },
    },
    'zh-CN': {
      ...localeShell({
        locale: 'zh-CN',
        slug: 'pump-b',
        title: '水泵乙',
        blocks: [{
          id: 'pump-b-zh-html',
          type: 'core/html',
          props: { html: '<p>水泵乙</p>' },
          children: [],
        }],
      }),
      fields: {
        specifications: [{ name: '流量', value: '20 L/min' }],
      },
    },
  },
)

await writeJson('source/i18n/en.json', {
  schemaVersion: 1,
  strings: {
    'theme:starter:read_more': 'Read more',
  },
})
await writeJson('source/i18n/zh-CN.json', {
  schemaVersion: 1,
  strings: {
    'theme:starter:read_more': '阅读更多',
  },
})

await fs.mkdir(path.join(fixtureRoot, 'assets', 'uploads'), { recursive: true })
await fs.writeFile(path.join(fixtureRoot, 'assets', 'uploads', '.gitkeep'), '', 'utf8')
await fs.mkdir(path.join(fixtureRoot, 'source', 'media'), { recursive: true })
await fs.writeFile(path.join(fixtureRoot, 'source', 'media', '.gitkeep'), '', 'utf8')
await fs.mkdir(path.join(fixtureRoot, 'tools'), { recursive: true })
await fs.writeFile(path.join(fixtureRoot, 'tools', 'site-verify.mjs'), 'process.exit(0)\n', 'utf8')

console.log(`fixture written: ${fixtureRoot}`)
console.log(JSON.stringify({
  GROUP_IDS,
  ITEM_IDS,
  PRODUCTS_ID,
  pageIds: content.pages.map((page) => ({ role: page.meta.role, pageId: page.meta.pageId })),
  collectionIds: content.collections.map((collection) => ({
    name: collection.name,
    collectionId: collection.collectionId,
    prefix: collection.prefix,
  })),
}, null, 2))
