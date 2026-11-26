import { describe, expect, it } from 'vitest'
import {
  BASIC_INFO_SEARCH_QUERIES,
  mergeExtractedBasicInfo,
  normalizeBasicInfoUrl,
  rankWikiPathsFromSearchHits,
  readBasicInfoSnapshot,
  type BasicInfoSnapshot,
} from './extract-basic-info.js'
import type { ManagedSiteSettings, PluginsConfig } from '@olps/domain'

function sampleBefore(): BasicInfoSnapshot {
  return {
    siteName: 'New Site',
    siteUrl: '',
    company: { name: '', address: '', phone: '', email: 'hello@example.com' },
    socialLinks: [],
    iconMediaId: null,
    whatsappPhone: '',
    mapsAddress: '',
    qrMedia: [],
  }
}

describe('mergeExtractedBasicInfo', () => {
  it('用知识库抽取结果填充空字段，并提升 logo 与二维码', () => {
    const after = mergeExtractedBasicInfo({
      before: sampleBefore(),
      extracted: {
        siteName: 'Acme Pumps',
        siteUrl: 'http://acme.example',
        company: {
          name: 'Acme Manufacturing',
          address: '100 Industry Road',
          phone: '+1-555-0100',
          email: 'sales@acme.example',
        },
        socialLinks: [{ platform: 'LinkedIn', url: 'http://linkedin.com/company/acme' }],
        logoAssetId: 'logo-1',
        qrAssetIds: ['qr-1'],
        whatsappPhone: '+1-555-0100',
        mapsAddress: '100 Industry Road',
      },
      logoMediaId: 'media-logo',
      qrMedia: [{ mediaId: 'media-qr', caption: '微信二维码', path: 'assets/uploads/2026/11/media-qr.png' }],
    })
    expect(after).toEqual({
      siteName: 'Acme Pumps',
      siteUrl: 'http://acme.example',
      company: {
        name: 'Acme Manufacturing',
        address: '100 Industry Road',
        phone: '+1-555-0100',
        email: 'sales@acme.example',
      },
      socialLinks: [{ platform: 'LinkedIn', url: 'http://linkedin.com/company/acme' }],
      iconMediaId: 'media-logo',
      whatsappPhone: '+1-555-0100',
      mapsAddress: '100 Industry Road',
      qrMedia: [{ mediaId: 'media-qr', caption: '微信二维码', path: 'assets/uploads/2026/11/media-qr.png' }],
    })
  })

  it('空字符串候选不覆盖已有值', () => {
    const before: BasicInfoSnapshot = {
      ...sampleBefore(),
      siteName: 'Existing',
      company: { name: 'Existing Co', address: 'Old Rd', phone: '111', email: 'old@example.com' },
    }
    const after = mergeExtractedBasicInfo({
      before,
      extracted: {
        siteName: '   ',
        company: { name: '', address: null, phone: null, email: null },
        socialLinks: [],
        logoAssetId: null,
        qrAssetIds: [],
        whatsappPhone: null,
        mapsAddress: null,
      },
      logoMediaId: null,
      qrMedia: [],
    })
    expect(after.siteName).toBe('Existing')
    expect(after.company).toEqual(before.company)
    expect(after.socialLinks).toEqual([])
  })
})

describe('normalizeBasicInfoUrl', () => {
  it('保留 http/https，仅为无协议主机名补 https', () => {
    expect(normalizeBasicInfoUrl('http://www.diesels-generators.com/')).toBe(
      'http://www.diesels-generators.com/',
    )
    expect(normalizeBasicInfoUrl('https://example.com')).toBe('https://example.com')
    expect(normalizeBasicInfoUrl('http://127.0.0.1:8787/s/demo')).toBe('http://127.0.0.1:8787/s/demo')
    expect(normalizeBasicInfoUrl('www.example.com')).toBe('https://www.example.com')
  })
})

describe('rankWikiPathsFromSearchHits', () => {
  it('按命中次数排序并忽略二进制素材路径', () => {
    const ranked = rankWikiPathsFromSearchHits([
      { path: 'wiki/sources/products/a/mlp150.md', query: 'WhatsApp' },
      { path: 'wiki/sources/products/a/mlp150.md', query: '邮箱' },
      { path: 'wiki/sources/products/b/other.md', query: '公司' },
      { path: 'raw/sources/logo.png', query: 'logo' },
      { path: 'wiki/assets-catalog.md', query: '公司' },
    ])
    expect(ranked[0]).toBe('wiki/sources/products/a/mlp150.md')
    expect(ranked).toContain('wiki/sources/products/b/other.md')
    expect(ranked).toContain('wiki/assets-catalog.md')
    expect(ranked.some((path) => path.endsWith('.png'))).toBe(false)
  })

  it('检索词列表覆盖联系方式与社媒关键词', () => {
    expect(BASIC_INFO_SEARCH_QUERIES).toEqual(
      expect.arrayContaining(['WhatsApp', 'WeChat', '联系方式', '邮箱', 'LinkedIn']),
    )
  })
})

describe('readBasicInfoSnapshot', () => {
  it('读取 settings 与插件中的电话、地址', () => {
    const settings = {
      schemaVersion: 1,
      siteName: 'Site',
      siteUrl: 'https://example.com',
      company: { name: 'Co', address: 'Addr', phone: '123', email: 'a@b.c' },
      iconMediaId: null,
      socialLinks: [{ platform: 'X', url: 'https://x.com/co' }],
      locales: [{ code: 'en', dir: 'ltr' }],
      defaultLocale: 'en',
      search: { allowIndexing: true, allowAiSearch: true, allowAiTraining: false },
    } satisfies ManagedSiteSettings
    const plugins = {
      schemaVersion: 1,
      plugins: {
        whatsapp: {
          enabled: true,
          permissionsAcceptedAt: null,
          permissionsAcceptedBy: null,
          settings: { phone: '999' },
        },
        'google-maps': {
          enabled: true,
          permissionsAcceptedAt: null,
          permissionsAcceptedBy: null,
          settings: { defaultAddress: { en: 'Harbour St', 'zh-CN': '港口街' } },
        },
      },
    } satisfies PluginsConfig
    expect(readBasicInfoSnapshot(settings, plugins, 'zh-CN')).toMatchObject({
      siteName: 'Site',
      whatsappPhone: '999',
      mapsAddress: '港口街',
      socialLinks: [{ platform: 'X', url: 'https://x.com/co' }],
    })
  })
})
