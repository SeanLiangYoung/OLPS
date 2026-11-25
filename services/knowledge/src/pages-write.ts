import {
  ManualDocumentError,
  createManualDocument,
  deleteManualDocument,
  manualWikiPath,
  updateManualDocument,
} from './manual-document.js'
import { deleteManualDocumentProjection, projectManualDocument } from './projection-sync.js'
import type { KnowledgeServiceConfig } from './types.js'

export type PagesWriteBody = {
  action: 'create' | 'update' | 'delete'
  documentId: string
  title?: string
  content?: string
}

function requireTitleContent(body: PagesWriteBody): { title: string; content: string } {
  const title = body.title?.trim() ?? ''
  const content = body.content ?? ''
  if (!title || !content) {
    throw new ManualDocumentError('invalid_request', 'title 与 content 必填')
  }
  return { title, content }
}

export async function handlePagesWrite(
  config: KnowledgeServiceConfig,
  siteId: string,
  body: PagesWriteBody,
): Promise<{ documentId: string; sourcePath?: string; wikiPath?: string }> {
  if (!body.documentId?.trim() || !/^[0-9a-f-]{36}$/i.test(body.documentId.trim())) {
    throw new ManualDocumentError('invalid_request', 'documentId 必须为 UUID')
  }
  const documentId = body.documentId.trim()
  if (body.action === 'delete') {
    await deleteManualDocument(config.knowledgeRoot, siteId, documentId)
    if (config.databaseUrl) {
      await deleteManualDocumentProjection({
        databaseUrl: config.databaseUrl,
        siteId,
        documentId,
      })
    }
    return { documentId }
  }
  const { title, content } = requireTitleContent(body)
  const written =
    body.action === 'create'
      ? await createManualDocument(config.knowledgeRoot, siteId, { documentId, title, content })
      : await updateManualDocument(config.knowledgeRoot, siteId, { documentId, title, content })
  if (config.databaseUrl) {
    await projectManualDocument({
      knowledgeRoot: config.knowledgeRoot,
      databaseUrl: config.databaseUrl,
      siteId,
      documentId,
      title,
      content,
      sourcePath: written.sourcePath,
      wikiPath: manualWikiPath(documentId),
      fingerprint: written.fingerprint,
    })
  }
  return {
    documentId,
    sourcePath: written.sourcePath,
    wikiPath: manualWikiPath(documentId),
  }
}