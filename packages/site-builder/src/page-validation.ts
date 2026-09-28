import { validateGuideGraph } from '@olps/domain'
import type { SiteSettings } from '@olps/domain'
import type { StoredPageJson } from './types.js'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function assertValidStoredPage(page: StoredPageJson): void {
  if (!isNonEmptyString(page.pageId)) {
    throw new Error('页面 JSON 缺少 pageId')
  }
  if (!isNonEmptyString(page.slug)) {
    throw new Error(`页面 ${page.pageId} 缺少 slug`)
  }
  if (!page.kind || !['site', 'content', 'ads'].includes(page.kind)) {
    throw new Error(`页面 ${page.pageId} kind 无效`)
  }
  if (!page.seo || !isNonEmptyString(page.seo.title) || !isNonEmptyString(page.seo.description)) {
    throw new Error(`页面 ${page.pageId} seo 不完整`)
  }
  if (!isNonEmptyString(page.locale)) {
    throw new Error(`页面 ${page.pageId} 缺少 locale`)
  }
  if (!page.body || typeof page.body.html !== 'string') {
    throw new Error(`页面 ${page.pageId} body.html 无效`)
  }
}

export function assertValidAdsPage(page: StoredPageJson, settings: SiteSettings): void {
  if (page.kind !== 'ads') {
    return
  }
  if (!page.body.ads) {
    throw new Error(`广告页 ${page.pageId} 缺少 body.ads`)
  }
  const result = validateGuideGraph(page.body.ads, { screenCap: settings.screenCap })
  if (!result.ok) {
    const detail = result.issues.map((i) => i.message).join('; ')
    throw new Error(`广告页 ${page.pageId} guide 校验失败: ${detail}`)
  }
}
