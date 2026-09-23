export type PageKind = 'site' | 'content' | 'ads'
export type PageStatus = 'draft' | 'published'

export type SeoFields = {
  title: string
  description: string
  canonical?: string
}

export type ScreenRole = 'entry' | 'content' | 'cta'

export type Screen = {
  screenId: string
  role: ScreenRole
  title: string
  html: string
  entryFor?: string[]
}

export type GuideAction = 'navigate' | 'go_cta' | 'link_page'

export type GuideOption = {
  id: string
  label: string
  action: GuideAction
  targetScreenId?: string
  pageId?: string
}

export type GuideNode = {
  options: GuideOption[]
}

export type GuideGraph = {
  entryByKeyword: Record<string, string>
  nodes: Record<string, GuideNode>
}

export type AdsPayload = {
  keywordCluster: string[]
  screens: Screen[]
  guide: GuideGraph
}

export type PageBody = {
  html: string
  blocks?: unknown[]
  ads?: AdsPayload
}

export type SiteSettings = {
  defaultLocale: string
  locales: string[]
  screenCap: number
  analyticsEnabled: boolean
  mapsEnabled: boolean
  mapsApiKey: string
  whatsappEnabled: boolean
  whatsappNumber: string
  whatsappLabel: string
}

export type SiteRecord = {
  siteId: string
  tenantId: string
  name: string
  settings: SiteSettings
  createdAt: string
  updatedAt: string
}

export type PageRecord = {
  pageId: string
  siteId: string
  tenantId: string
  kind: PageKind
  slug: string
  title: string
  status: PageStatus
  locale: string
  seo: SeoFields
  body: PageBody
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

export type GuideValidationIssue = {
  code: string
  message: string
  screenId?: string
  optionId?: string
}

export type GuideValidationResult = {
  ok: boolean
  issues: GuideValidationIssue[]
}
