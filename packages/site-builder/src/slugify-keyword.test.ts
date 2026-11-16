import { expect, it } from 'vitest'
import { slugifyKeyword } from './slugify-keyword.js'

it('中文关键词生成不同的可访问路径，英文路径保持一致', () => {
  expect(slugifyKeyword('产品甲')).not.toBe(slugifyKeyword('产品乙'))
  expect(slugifyKeyword('Buy Steel')).toBe('buy-steel')
  expect(slugifyKeyword('产品甲')).not.toBe('')
})
