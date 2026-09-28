import type { PageBody, PageKind } from '@olps/domain'
import { validateGuideGraph } from '@olps/domain'
import type { SyncWorkspace } from '@olps/sync'
import { readSiteSettingsFromWorkspace } from './workspace-factory.js'

export function validatePageBodyForKind(
  kind: PageKind,
  body: PageBody,
  screenCap: number,
): void {
  if (!body.ads) {
    return
  }
  if (kind !== 'ads') {
    throw new Error('INVALID_ADS')
  }
  const result = validateGuideGraph(body.ads, { screenCap })
  if (!result.ok) {
    throw new Error('INVALID_ADS')
  }
}

export async function validatePageBodyWithWorkspace(
  workspace: SyncWorkspace,
  kind: PageKind,
  body: PageBody,
): Promise<void> {
  const settings = await readSiteSettingsFromWorkspace(workspace)
  validatePageBodyForKind(kind, body, settings.screenCap)
}
