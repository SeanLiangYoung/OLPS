import type { PublishConfig } from './types.js'

export function remoteSiteIdFromPublicUrl(publicSiteUrl?: string): string | null {
  if (!publicSiteUrl) {
    return null
  }
  const match = publicSiteUrl.match(/\/s\/([^/]+)/i)
  return match?.[1] ?? null
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export function publicPageUrl(publishConfig: PublishConfig, routeSlug: string): string | null {
  if (!publishConfig.publicSiteUrl) {
    return null
  }
  const base = stripTrailingSlash(publishConfig.publicSiteUrl)
  return `${base}/${routeSlug}/`
}

export function sitePathPrefix(publishConfig: PublishConfig): string {
  const remoteId = remoteSiteIdFromPublicUrl(publishConfig.publicSiteUrl)
  if (remoteId) {
    return `/s/${remoteId}`
  }
  return ''
}

export function sitePagePath(publishConfig: PublishConfig, routeSlug: string): string {
  const prefix = sitePathPrefix(publishConfig)
  if (!prefix) {
    return `/${routeSlug}/`
  }
  return `${prefix}/${routeSlug}/`
}
