import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const adminSrc = join(import.meta.dirname, '.')

function read(relativePath: string): string {
  return readFileSync(join(adminSrc, relativePath), 'utf8')
}

describe('Admin 页面 API 路径', () => {
  it('详情页源码不引用单独的 /api/pages/:pageId', () => {
    const detail = read('pages/PageDetailPage.vue')
    expect(detail).not.toMatch(/\/api\/pages\/\$\{/)
    expect(detail).not.toMatch(/`\/api\/pages\//)
    expect(detail).toContain('draftPageDetailApiPath')
  })
})
