import { rewriteSiteAssetReferences } from '@olps/site-builder'
import { PREVIEW_PUBLISH_SITE_SEGMENT } from './preview-constants.js'

export function rewritePreviewPlanHtml(html: string, rawToken: string): string {
  const assetPrefix = `/preview-access/${rawToken}/s/${PREVIEW_PUBLISH_SITE_SEGMENT}`
  return rewriteSiteAssetReferences(html, assetPrefix)
}
