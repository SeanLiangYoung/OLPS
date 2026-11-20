import type { PageBody, PageKind, PageStatus, PublishConfig as DomainPublishConfig, SeoFields, SiteSettings } from '@olps/domain'
import type { SiteModel, SourceReader } from '@olps/render'

/** 旧单页 JSON 格式，供 API 预览兼容导出 */
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

/** 旧发布配置形状，供 API 预览兼容导出 */
export type PublishConfig = {
  publicSiteUrl?: string
  publicApiBaseUrl?: string
  siteId?: string
}

/** 旧 LoadedWorkspace，供 API 预览兼容导出 */
export type LoadedWorkspace = {
  settings: SiteSettings
  publishConfig: PublishConfig
  pages: StoredPageJson[]
}

/** 旧预览 HTML 计划；内容为字符串 */
export type PlannedFile = {
  relativePath: string
  content: string
}

/** 整站写入 public/ 的文件（可含二进制资源） */
export type OutputFile = {
  relativePath: string
  content: string | Buffer
}

export type LoadedSiteWorkspace = {
  workspacePath: string
  reader: SourceReader
  model: SiteModel
  domainPublishConfig: DomainPublishConfig
}

export type HtmlOutputFile = {
  relativePath: string
  content: string
}
