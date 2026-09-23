export type PageKind = 'site' | 'content' | 'ads'
export type PageStatus = 'draft' | 'published'
export type InquiryStatus = 'new' | 'processing' | 'done' | 'spam'

export type Site = {
  siteId: string
  name: string
  settings?: SiteSettings
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

export type SeoFields = {
  title: string
  description: string
  canonical?: string
}

export type GuideOption = {
  id: string
  label: string
  action: string
  targetScreenId?: string
  pageId?: string
}

export type Screen = {
  screenId: string
  role: string
  title: string
  html: string
  entryFor?: string[]
}

export type AdsPayload = {
  keywordCluster: string[]
  screens: Screen[]
  guide: {
    entryByKeyword: Record<string, string>
    nodes: Record<string, { options: GuideOption[] }>
  }
}

export type PageRecord = {
  pageId: string
  siteId: string
  kind: PageKind
  title: string
  slug: string
  status: PageStatus
  locale?: string
  seo: SeoFields
  body: {
    html: string
    ads?: AdsPayload
  }
  updatedAt: string
  publishedAt?: string | null
  publicUrls?: string[]
}

export type JobRecord = {
  jobId: string
  siteId?: string
  type?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  request?: Record<string, unknown>
  result?: Record<string, unknown> | null
  error?: string | null
  createdAt?: string
  updatedAt?: string
}

export type KnowledgeBase = {
  kbId: string
  name: string
  createdAt?: string
}

export type KnowledgeDocument = {
  docId: string
  kbId: string
  title: string
  content: string
  createdAt?: string
}

export type Inquiry = {
  inquiryId: number | string
  pageId: string | null
  status: InquiryStatus | string
  payload: Record<string, unknown>
  createdAt: string
}

export type SiteIntegrations = {
  siteId?: string
  adsAccountId: string
  adsConnected: boolean
  gaPropertyId: string
  gaConnected: boolean
  updatedAt?: string
}

export type ReportChecklistItem = {
  id: string
  label: string
  passed: boolean
  detail: string
}

export type ReportRecord = {
  reportId: string
  siteId: string
  pageId: string
  score: number
  checklist: ReportChecklistItem[]
  createdAt: string
}

export type DashboardData = {
  siteId?: string
  pagesByKind: { site: number; content: number; ads: number }
  publishedCount: number
  inquiryCount: number
  sitemapUrl: string
  recentJobs: JobRecord[]
}
