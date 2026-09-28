import type { PageBody, PageKind, PageStatus, SeoFields, SiteSettings } from '@olps/domain'

export type StoredPageJson = {
  pageId: string
  kind: PageKind
  slug: string
  title: string
  status: PageStatus
  locale: string
  seo: SeoFields
  body: PageBody
  publishedAt?: string | null
}

export type PublishConfig = {
  publicSiteUrl?: string
  publicApiBaseUrl?: string
  siteId?: string
}

export type LoadedWorkspace = {
  settings: SiteSettings
  publishConfig: PublishConfig
  pages: StoredPageJson[]
}

export type PlannedFile = {
  relativePath: string
  content: string
}
