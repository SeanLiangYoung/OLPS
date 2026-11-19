import { isDraftOwner } from './permissions.js'
import { getDraftPageForUser } from './drafts-service.js'
import { fetchDraftRow, openDraftWorkspaceFromRow } from './draft-preview-support.js'
import {
  createPreviewToken,
  insertPreviewCapability,
} from './preview-capability-store.js'
import { buildPreviewArtifacts, writePreviewArtifactTree } from './preview-build.js'
import { readPageFromWorkspace, type StoredPageJson } from './page-sandbox.js'

export async function previewDraftPage(
  userId: string,
  sessionId: string,
  draftId: string,
  pageId: string,
): Promise<string> {
  if (!(await isDraftOwner(userId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const page = await getDraftPageForUser(userId, draftId, pageId)
  if (!page) {
    throw new Error('NOT_FOUND')
  }
  const row = await fetchDraftRow(draftId)
  const workspace = await openDraftWorkspaceFromRow(row)
  const json = await readPageFromWorkspace(workspace, pageId)
  if (!json) {
    throw new Error('NOT_FOUND')
  }

  const rawToken = createPreviewToken()
  const { entryRelativePath, files } = await buildPreviewArtifacts({
    workspace,
    pageJson: json as StoredPageJson,
    rawToken,
    draftId,
  })
  const entryRoute = entryRelativePath.replace(/\/index\.html$/, '')
  const { capabilityId } = await insertPreviewCapability({
    sessionId,
    userId,
    draftId,
    pageId,
    pageSlug: json.slug,
    entryRoute,
    rawToken,
  })
  await writePreviewArtifactTree(capabilityId, files)

  return `/preview-access/${rawToken}/${entryRoute}/`
}
