import { relativeUrl, resolveContentRef, type SiteModel } from '@olps/render'
import { escapeAttribute, siteAbsoluteUrl } from './html-output.js'
import { collectPublicHtmlRoutes } from './public-html-routes.js'
import type { OutputFile } from './types.js'

export function resolvedRedirects(model: SiteModel, mode: 'publish' | 'preview' = 'publish'): Array<{ from: string; to: string }> {
  return model.redirects.redirects.map(redirect => {
    const relative = resolveContentRef(model, redirect.target, { locale: redirect.locale, fromUrl: redirect.from, mode })
    const to = new URL(relative, `https://redirect.invalid${redirect.from}`).pathname
    if (redirect.from === to) throw new Error(`跳转地址形成循环：${redirect.from}`)
    return { from: redirect.from, to }
  })
}

function redirectPage(from: string, to: string, siteUrl: string): string {
  const relative = relativeUrl(from, to)
  const canonical = siteAbsoluteUrl(siteUrl, to)
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="canonical" href="${escapeAttribute(canonical)}"><meta http-equiv="refresh" content="0; url=${escapeAttribute(relative)}"><title>Redirect</title></head><body><a href="${escapeAttribute(relative)}">Continue</a><script>location.replace(${JSON.stringify(relative).replaceAll('<', '\\u003c')})</script></body></html>`
}

export function planRedirects(model: SiteModel, mode: 'publish' | 'preview' = 'publish'): OutputFile[] {
  const redirects = [{ from: '/', to: `/${model.settings.defaultLocale}/` }, ...resolvedRedirects(model, mode)]
  const occupied = new Set(collectPublicHtmlRoutes(model, mode).map(route => route.relativePath))
  const seen = new Set<string>()
  return redirects.map(redirect => {
    if (!redirect.from.startsWith('/') || !redirect.from.endsWith('/') || redirect.from.includes('..') || redirect.from.includes('\\')) {
      throw new Error(`跳转来源地址无效：${redirect.from}`)
    }
    const relativePath = `${redirect.from.slice(1)}index.html`
    if (occupied.has(relativePath)) throw new Error(`跳转地址与现有页面冲突：${redirect.from}`)
    if (seen.has(relativePath)) throw new Error(`跳转来源地址重复：${redirect.from}`)
    seen.add(relativePath)
    return { relativePath, content: redirectPage(redirect.from, redirect.to, model.settings.siteUrl) }
  })
}
