import { ManualDocumentError, copyManualDocumentBetweenSites, manualWikiPath } from './manual-document.js'
import { projectManualDocument } from './projection-sync.js'
import type { KnowledgeServiceConfig } from './types.js'

export type ManualCopyBody = {
  targetSiteId: string
  newDocumentId: string
}

export async function handleManualDocumentCopy(
  config: KnowledgeServiceConfig,
  sourceSiteId: string,
  sourceDocumentId: string,
  body: ManualCopyBody,
): Promise<{ documentId: string; targetSiteId: string }> {
  if (!body.targetSiteId?.trim() || !body.newDocumentId?.trim()) {
    throw new ManualDocumentError('invalid_request', 'targetSiteId 与 newDocumentId 必填')
  }
  if (!/^[0-9a-f-]{36}$/i.test(body.newDocumentId.trim())) {
    throw new ManualDocumentError('invalid_request', 'newDocumentId 必须为 UUID')
  }
  const copied = await copyManualDocumentBetweenSites({
    knowledgeRoot: config.knowledgeRoot,
    sourceSiteId,
    targetSiteId: body.targetSiteId.trim(),
    sourceDocumentId,
    newDocumentId: body.newDocumentId.trim(),
  })
  if (config.databaseUrl) {
    await projectManualDocument({
      knowledgeRoot: config.knowledgeRoot,
      databaseUrl: config.databaseUrl,
      siteId: body.targetSiteId.trim(),
      documentId: body.newDocumentId.trim(),
      title: copied.title,
      content: copied.content,
      sourcePath: copied.sourcePath,
      wikiPath: manualWikiPath(body.newDocumentId.trim()),
      fingerprint: copied.fingerprint,
      sourceDocumentId: sourceDocumentId,
    })
  }
  return { documentId: body.newDocumentId.trim(), targetSiteId: body.targetSiteId.trim() }
}