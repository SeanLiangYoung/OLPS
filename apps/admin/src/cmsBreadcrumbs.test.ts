import { describe, expect, it } from 'vitest'
import { resolveCmsBreadcrumbs } from './cmsBreadcrumbs'

describe('resolveCmsBreadcrumbs', () => {
  it('网站资料页返回自动驾驶 / 网站资料', () => {
    expect(resolveCmsBreadcrumbs('/knowledge')).toEqual([
      { label: '自动驾驶' },
      { label: '网站资料' },
    ])
  })

  it('AI 建站页返回自动驾驶 / AI 建站', () => {
    expect(resolveCmsBreadcrumbs('/generate')).toEqual([
      { label: '自动驾驶' },
      { label: 'AI 建站' },
    ])
  })

  it('网站概况为单级面包屑', () => {
    expect(resolveCmsBreadcrumbs('/dashboard')).toEqual([{ label: '网站概况' }])
  })

  it('未知路径返回空列表', () => {
    expect(resolveCmsBreadcrumbs('/login')).toEqual([])
  })
})
