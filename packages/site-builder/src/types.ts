import type { PublishConfig as DomainPublishConfig } from '@olps/domain'
import type { SiteModel, SourceReader } from '@olps/render'

export type BuildOptions = {pluginSecrets?:Record<string,Record<string,string>>}

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
