import type { AdsPayload, GuideGraph, PageBody } from '@olps/domain'
import { validateGuideGraph } from '@olps/domain'
import { isDraftOwner } from './permissions.js'
import {
  getDraftForUser,
  getDraftPageForUser,
  patchDraftPageForUser,
} from './drafts-service.js'
import { validatePageBodyForKind } from './page-body-validation.js'
import { readSiteSettingsFromWorkspace } from './workspace-factory.js'
import { fetchDraftRow, openDraftWorkspaceFromRow } from './draft-preview-support.js'
import {
  createPreviewToken,
  insertPreviewCapability,
} from './preview-capability-store.js'
import { buildPreviewArtifacts, writePreviewArtifactTree } from './preview-build.js'
import { readPageFromWorkspace, type StoredPageJson } from './page-sandbox.js'

export async function patchPageGuide(
  userId: string,
  draftId: string,
  pageId: string,
  guide: GuideGraph,
) {
  const page = await getDraftPageForUser(userId, draftId, pageId)
  if (!page) {
    throw new Error('NOT_FOUND')
  }
  if (!page.body.ads) {
    throw new Error('页面不是广告类型，无法设置 guide')
  }
  const body: PageBody = {
    ...page.body,
    ads: { ...page.body.ads, guide },
  }
  const row = await fetchDraftRow(draftId)
  const workspace = await openDraftWorkspaceFromRow(row)
  const settings = await readSiteSettingsFromWorkspace(workspace)
  validatePageBodyForKind(page.kind, body, settings.screenCap)
  return patchDraftPageForUser(userId, draftId, pageId, { body })
}

export async function validatePageGuide(
  userId: string,
  draftId: string,
  pageId: string,
  adsOverride?: AdsPayload,
) {
  const page = await getDraftPageForUser(userId, draftId, pageId)
  if (!page) {
    throw new Error('NOT_FOUND')
  }
  const ads = adsOverride ?? page.body.ads
  if (!ads) {
    throw new Error('页面不是广告类型')
  }
  const draft = await getDraftForUser(userId, draftId)
  const screenCap = draft?.settings.screenCap ?? 20
  return validateGuideGraph(ads, { screenCap })
}

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
