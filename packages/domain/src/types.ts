export type PageKind = 'site' | 'content' | 'ads'
export type PageStatus = 'draft' | 'published' | 'unpublished'

export type SeoFields = {
  title: string
  description: string
  canonical?: string
  image?: string
  robots?: 'index,follow' | 'noindex,nofollow'
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
  mapsQuery?: string
  whatsappEnabled: boolean
  whatsappNumber: string
  whatsappLabel: string
}

export type UserRecord = {
  userId: string
  account: string
  name: string
}

export type SiteRecord = {
  siteId: string
  name: string
  settings: SiteSettings
  remoteSiteId: string | null
  publishedCommitId: string | null
  publicUrl: string | null
  createdAt: string
  updatedAt: string
}

export type DraftStatus = 'active' | 'syncing' | 'conflict' | 'error' | 'archived'

export type DraftSyncStatus =
  | 'clean'
  | 'dirty'
  | 'merge_conflict'
  | 'awaiting_user'
  | 'validation_failed'

export type DraftInitStatus = 'initializing' | 'ready' | 'failed'

export type DraftRecord = {
  draftId: string
  siteId: string | null
  name: string
  initStatus: DraftInitStatus
  settings: SiteSettings
  sandboxId: string
  baseCommitId: string | null
  headCommitId: string | null
  status: DraftStatus
  syncStatus?: DraftSyncStatus
  conflictMessage?: string | null
  conflictSummary?: string | null
  validationLog?: string | null
  pendingOperation?: 'pull' | 'push' | null
  lastError?: string | null
  createdAt: string
  updatedAt: string
}

export type PageRecord = {
  metadata?: Record<string, unknown>
  pageId: string
  translationGroupId?: string
  draftId: string
  siteId: string | null
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
