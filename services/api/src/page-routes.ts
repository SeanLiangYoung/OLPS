import fs from 'node:fs/promises'
import path from 'node:path'
import type { AdsPayload, GuideGraph, PageBody } from '@olps/domain'
import { validateGuideGraph } from '@olps/domain'
import { appConfig } from './config.js'
import { getDraftForUser, getDraftPageForUser, patchDraftPageForUser } from './drafts-service.js'
import { adsRuntimeScript } from './ads-runtime.js'

function buildPreviewHtml(page: {
  kind: string
  pageId: string
  siteId: string | null
  body: PageBody
}): string {
  if (page.body.ads) {
    const ads = page.body.ads
    const payloadJson = JSON.stringify({
      keywordCluster: ads.keywordCluster,
      screens: ads.screens,
      guide: ads.guide,
    })
    const siteId = page.siteId ?? 'preview'
    const inquiryPath = `${appConfig.publicApiBaseUrl}/api/public/${encodeURIComponent(siteId)}/inquiries?pageId=${encodeURIComponent(page.pageId)}`
    const entry = ads.screens.find((s) => s.role === 'entry') ?? ads.screens[0]
    const rootHtml = entry?.html ?? ''
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Preview</title>
</head>
<body>
<div id="olps-ads-root">${rootHtml}</div>
${adsRuntimeScript(payloadJson, inquiryPath)}
</body>
</html>`
  }
  const html = page.body.html ?? ''
  if (/<html[\s>]/i.test(html)) {
    return html
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Preview</title>
</head>
<body>
${html}
</body>
</html>`
}

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
  const screenCap = draft?.settings.screenCap ?? appConfig.defaultScreenCap
  return validateGuideGraph(ads, { screenCap })
}

export async function previewDraftPage(userId: string, draftId: string, pageId: string) {
  const page = await getDraftPageForUser(userId, draftId, pageId)
  if (!page) {
    throw new Error('NOT_FOUND')
  }
  const html = buildPreviewHtml({
    kind: page.kind,
    pageId: page.pageId,
    siteId: page.siteId,
    body: page.body,
  })
  const dir = path.join(appConfig.previewRoot, draftId, pageId)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'index.html'), html, 'utf8')
  return `/preview/${draftId}/${pageId}/`
}

export async function readPreviewHtml(draftId: string, pageId: string): Promise<string | null> {
  const file = path.join(appConfig.previewRoot, draftId, pageId, 'index.html')
  try {
    return await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }
}
