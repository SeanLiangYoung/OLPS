import { expect, it } from 'vitest'
import { buildReportRewriteRoute, readReportRewriteBrief } from './reportRewrite'

it('长篇改写要求通过报告编号传递，生成网址不包含正文', () => {
  const report = { reportId: 'report', draftId: 'draft', pageId: 'page', details: { rewriteBrief: '改进内容'.repeat(3000) } }
  const route = buildReportRewriteRoute(report)
  expect(route).toEqual({ path: '/generate', query: { operation: 'rewrite', pageId: 'page', reportId: 'report' } })
  expect(readReportRewriteBrief(report, 'draft', 'page')).toBe(report.details.rewriteBrief)
  expect(new URLSearchParams(route.query).toString().length).toBeLessThan(200)
})

it('拒绝其他草稿或页面的报告要求', () => {
  const report = { reportId: 'report', draftId: 'draft', pageId: 'page', details: { rewriteBrief: '更新产品介绍' } }
  expect(() => readReportRewriteBrief(report, 'other-draft', 'page')).toThrow('报告不属于当前草稿和页面')
  expect(() => readReportRewriteBrief(report, 'draft', 'other-page')).toThrow('报告不属于当前草稿和页面')
})

it('本地检查报告没有模型改写要求时显示明确错误', () => {
  expect(() => readReportRewriteBrief({ reportId: 'report', draftId: 'draft', pageId: 'page', details: null }, 'draft', 'page')).toThrow('该报告没有可使用的改写要求')
})
