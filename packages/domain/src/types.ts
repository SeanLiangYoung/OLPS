export type PageKind = 'site' | 'content'
export type PageStatus = 'draft' | 'published'

export type SeoFields = {
  title: string
  description: string
  canonical?: string
}

export type PageBody = {
  html: string
  blocks?: unknown[]
}

export type SiteSettings = {
  defaultLocale: string
  locales: string[]
  analyticsEnabled: boolean
  mapsEnabled: boolean
  mapsApiKey: string
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
  pageId: string
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
