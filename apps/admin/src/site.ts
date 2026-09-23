import { api } from './api'
import type { Site } from './types'

const SITE_KEY = 'olps_site'

export function getStoredSiteId(): string {
  return localStorage.getItem(SITE_KEY) ?? ''
}

export function setStoredSiteId(siteId: string): void {
  localStorage.setItem(SITE_KEY, siteId)
}

/** 列出站点；若无站点则创建一个默认站点，并记住当前站点。 */
export async function ensureSite(): Promise<Site> {
  const listed = await api<{ sites: Site[] }>('GET', '/api/sites')
  let sites = listed.sites ?? []
  if (!sites.length) {
    const created = await api<{ site: Site }>('POST', '/api/sites', { name: 'Default Site' })
    sites = [created.site]
  }
  const stored = getStoredSiteId()
  const matched = sites.find((s) => s.siteId === stored)
  const site = matched ?? sites[0]!
  setStoredSiteId(site.siteId)
  return site
}

export async function listSites(): Promise<Site[]> {
  const listed = await api<{ sites: Site[] }>('GET', '/api/sites')
  return listed.sites ?? []
}
