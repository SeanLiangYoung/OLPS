import { createNodeSourceReader } from './node-source-reader.js'
import { fullSiteFixtureRoot } from './paths.js'
import { loadSiteModel, type SiteModel } from '../site-model.js'
import type { SourceReader } from '../source-reader.js'

export async function loadFullSite(): Promise<{
  reader: SourceReader
  model: SiteModel
}> {
  const reader = createNodeSourceReader(fullSiteFixtureRoot)
  const model = await loadSiteModel(reader)
  return { reader, model }
}
