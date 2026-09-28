import { describe, expect, it } from 'vitest'
import { previewIframeSandboxTokens, readPageDetailVueSource } from './test-support/pagePreviewFrameAnalyze'

describe('页面预览 iframe 沙箱（compiler 解析模板）', () => {
  it('title=page-preview 的 iframe 须允许 scripts 与 forms，且禁止 allow-same-origin', () => {
    const tokens = previewIframeSandboxTokens(readPageDetailVueSource())
    expect(tokens).toContain('allow-scripts')
    expect(tokens).toContain('allow-forms')
    expect(tokens).not.toContain('allow-same-origin')
  })
})
