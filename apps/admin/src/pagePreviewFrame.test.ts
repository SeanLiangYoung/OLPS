import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('页面预览 iframe 沙箱', () => {
  it('预览 iframe 启用 allow-scripts allow-forms，不含 allow-same-origin', () => {
    const source = readFileSync(
      join(import.meta.dirname, 'pages/PageDetailPage.vue'),
      'utf8',
    )
    expect(source).toContain('data-testid="page-preview-iframe"')
    expect(source).toContain('sandbox="allow-scripts allow-forms"')
    expect(source).not.toContain('allow-same-origin')
  })
})
