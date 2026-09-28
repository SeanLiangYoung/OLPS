export type PageKind = 'site' | 'content' | 'ads'
export type PageStatus = 'draft' | 'published'
export type InquiryStatus = 'new' | 'processing' | 'done' | 'spam'

export type DraftStatus = 'active' | 'syncing' | 'conflict' | 'error'

/** sandbox Git 工作区处理状态（API 透传 @olps/sync） */
export type DraftSyncStatus =
  | 'clean'
  | 'dirty'
  | 'merge_conflict'
  | 'awaiting_user'
  | 'validation_failed'

export type User = {
  userId: string
  account: string
  name: string
}

export type PublishedSite = {
  siteId: string
  name: string
  settings?: SiteSettings
  remoteSiteId?: string
  publishedCommitId?: string | null
  publicUrl?: string | null
  createdAt?: string
  updatedAt?: string
}

export type SiteDraft = {
  draftId: string
  siteId: string | null
  name: string
  settings: SiteSettings
  sandboxId: string
  baseCommitId: string | null
  headCommitId: string | null
  status: DraftStatus
  syncStatus?: DraftSyncStatus | null
  conflictMessage?: string | null
  conflictSummary?: string | null
  validationLog?: string | null
  lastError?: string | null
  pendingOperation?: 'pull' | 'push' | null
  createdAt: string
  updatedAt: string
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
  draftId?: string
  siteId?: string
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
  draftId?: string
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
  draftId?: string
  score: number
  checklist: ReportChecklistItem[]
  createdAt: string
}

export type DashboardData = {
  draftId?: string
  siteId?: string
  pagesByKind: { site: number; content: number; ads: number }
  publishedCount: number
  inquiryCount: number
  sitemapUrl: string
  recentJobs: JobRecord[]
}
