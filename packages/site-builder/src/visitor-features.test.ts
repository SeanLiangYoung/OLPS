import { describe, expect, it } from 'vitest'
import { defaultSiteSettings } from '@olps/domain'
import { computeBuildPlan } from './plan.js'
import type { LoadedWorkspace, StoredPageJson } from './types.js'
import { listPageTranslations } from './translations.js'

function workspace(): LoadedWorkspace {
  return {
    settings: { ...defaultSiteSettings(), analyticsEnabled: false, locales: ['en', 'fr', 'ja'] },
    publishConfig: { publicSiteUrl: 'https://example.com/s/demo', publicApiBaseUrl: 'https://api.example.com', siteId: 'site-1' },
    pages: [{ pageId: 'home', kind: 'site', slug: 'home', title: 'Home', status: 'published', locale: 'en', seo: { title: 'Home SEO', description: 'Description' }, body: { html: '<main>Welcome</main>' }, translationGroupId: 'home-group', updatedAt: '2026-10-25T08:00:00.000Z' } as StoredPageJson],
  }
}

describe('访客配置和 SEO', () => {
  it('提供缺少翻译的信息并拒绝重复语言', () => {
    const loaded = workspace()
    expect(listPageTranslations(loaded.pages[0]!, loaded.pages, loaded.settings).missingLocales).toEqual(['fr', 'ja'])
    loaded.pages.push({ ...loaded.pages[0]!, pageId: 'duplicate' })
    expect(() => computeBuildPlan(loaded)).toThrow('重复语言')
  })

  it('拒绝无效修改时间、地图配置和 WhatsApp 号码', () => {
    const loaded = workspace()
    loaded.pages[0]!.updatedAt = 'invalid'
    expect(() => computeBuildPlan(loaded)).toThrow('updatedAt')
    loaded.pages[0]!.updatedAt = '2026-10-25T08:00:00.000Z'
    loaded.settings.mapsEnabled = true
    expect(() => computeBuildPlan(loaded)).toThrow('mapsQuery')
    loaded.settings.mapsEnabled = false
    loaded.settings.whatsappEnabled = true
    loaded.settings.whatsappNumber = 'invalid'
    expect(() => computeBuildPlan(loaded)).toThrow('whatsappNumber')
  })
  it('生成已关联翻译的 hreflang、语言入口、SEO 和最后修改时间', () => {
    const loaded = workspace()
    loaded.pages.push({ ...loaded.pages[0]!, pageId: 'home-fr', slug: 'accueil', locale: 'fr' })
    const files = new Map(computeBuildPlan(loaded).map(file => [file.relativePath, file.content]))
    const html = files.get('home/index.html')!
    expect(html).toContain('hreflang="fr" href="https://example.com/s/demo/accueil/"')
    expect(html).toContain('hreflang="x-default" href="https://example.com/s/demo/home/"')
    expect(html).toContain('data-olps-languages')
    expect(html).toContain('property="og:title" content="Home SEO"')
    expect(html).toContain('name="twitter:card" content="summary"')
    expect(html).toContain('name="robots" content="index,follow"')
    expect(files.get('sitemap.xml')).toContain('<lastmod>2026-10-25T08:00:00.000Z</lastmod>')
    expect(files.get('robots.txt')).toContain('Sitemap: https://example.com/s/demo/sitemap.xml')
  })

  it('设置控制地图、WhatsApp 和行为采集', () => {
    const loaded = workspace()
    loaded.settings = { ...loaded.settings, analyticsEnabled: true, mapsEnabled: true, mapsApiKey: 'map-key', mapsQuery: 'Paris France', whatsappEnabled: true, whatsappNumber: '+33 12345678', whatsappLabel: 'Contact us' } as LoadedWorkspace['settings']
    const html = computeBuildPlan(loaded).find(file => file.relativePath === 'home/index.html')!.content
    expect(html).toContain('https://www.google.com/maps/embed/v1/place?key=map-key&amp;q=Paris+France')
    expect(html).toContain('href="https://wa.me/3312345678"')
    expect(html).toContain('Contact us')
    expect(html).toContain('https://api.example.com/api/public/site-1/events')
    expect(html).toContain('page_view')
    expect(html).toContain('whatsapp_click')
    loaded.settings = { ...loaded.settings, analyticsEnabled: false, mapsEnabled: false, whatsappEnabled: false }
    const disabled = computeBuildPlan(loaded).find(file => file.relativePath === 'home/index.html')!.content
    expect(disabled).not.toContain('olps-visitor-runtime')
    expect(disabled).not.toContain('wa.me')
    expect(disabled).not.toContain('maps/embed')
  })
})
