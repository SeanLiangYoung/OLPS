import { draftPagesListPath } from './draftBusinessContext'
import type { PageRecord } from './types'

export function reportCandidatePagesPath(draftId: string): string {
  return draftPagesListPath(draftId)
}

export function pickReportCandidatePages(
  draftPages: PageRecord[],
  _sitePublishedPages: PageRecord[],
): PageRecord[] {
  return draftPages
}
