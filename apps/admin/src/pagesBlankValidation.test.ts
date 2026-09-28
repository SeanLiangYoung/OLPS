import { describe, expect, it } from 'vitest'
import { blankPageCreateError } from './pagesBlankValidation'

describe('创建空白页必填', () => {
  it('标题或 slug 为空时返回错误文案', () => {
    expect(blankPageCreateError('', 'ok-slug')).toBe('请填写标题与 slug')
    expect(blankPageCreateError('  ', 'ok-slug')).toBe('请填写标题与 slug')
    expect(blankPageCreateError('标题', '')).toBe('请填写标题与 slug')
    expect(blankPageCreateError('标题', '   ')).toBe('请填写标题与 slug')
  })

  it('标题与 slug 均有内容时通过', () => {
    expect(blankPageCreateError('首页', 'home')).toBeNull()
  })
})
