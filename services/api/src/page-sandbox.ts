import { pageJsonPath } from '@olps/sync'
import type { PageBody, PageKind, PageRecord, PageStatus, SeoFields } from '@olps/domain'
import { defaultSiteSettings } from '@olps/domain'
import type { SyncWorkspace } from '@olps/sync'

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

export function pageRecordFromJson(
  draftId: string,
  siteId: string | null,
  json: StoredPageJson,
  timestamps: { createdAt: string; updatedAt: string },
): PageRecord {
  return {
    pageId: json.pageId,
    draftId,
    siteId,
    kind: json.kind,
    slug: json.slug,
    title: json.title,
    status: json.status,
    locale: json.locale,
    seo: json.seo,
    body: json.body,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    publishedAt: json.publishedAt ?? null,
  }
}

export async function readPageFromWorkspace(
  workspace: SyncWorkspace,
  pageId: string,
): Promise<StoredPageJson | null> {
  try {
    const raw = await workspace.readFile(pageJsonPath(pageId))
    return JSON.parse(raw.toString('utf8')) as StoredPageJson
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return null
    }
    throw err
  }
}

export async function writePageToWorkspace(
  workspace: SyncWorkspace,
  json: StoredPageJson,
): Promise<void> {
  const content = `${JSON.stringify(json, null, 2)}\n`
  await workspace.writeFile(pageJsonPath(json.pageId), Buffer.from(content, 'utf8'))
}

export function defaultPageJson(input: {
  pageId: string
  kind: PageKind
  slug: string
  title: string
  locale?: string
}): StoredPageJson {
  const settings = defaultSiteSettings()
  const locale = input.locale ?? settings.defaultLocale
  return {
    pageId: input.pageId,
    kind: input.kind,
    slug: input.slug,
    title: input.title,
    status: 'draft',
    locale,
    seo: { title: input.title, description: input.title },
    body: { html: `<h1>${input.title}</h1>` },
    publishedAt: null,
  }
}
