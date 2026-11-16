export type ReportRewriteSource = {
  reportId: string
  draftId?: string | null
  pageId: string
  details?: { rewriteBrief?: string } | null
}

export function buildReportRewriteRoute(report: ReportRewriteSource) {
  return { path: '/generate', query: { operation: 'rewrite', pageId: report.pageId, reportId: report.reportId } }
}

export function readReportRewriteBrief(report: ReportRewriteSource, draftId: string, pageId: string): string {
  if (report.draftId !== draftId || report.pageId !== pageId) throw new Error('报告不属于当前草稿和页面')
  if (!report.details?.rewriteBrief?.trim()) throw new Error('该报告没有可使用的改写要求')
  return report.details.rewriteBrief
}
