import { describe, expect, it } from 'vitest'
import { resolveCmsBreadcrumbs } from './cmsBreadcrumbs'

describe('resolveCmsBreadcrumbs', () => {
  it('网站资料页返回网站内容 / 网站资料', () => {
    expect(resolveCmsBreadcrumbs('/knowledge')).toEqual([
      { label: '网站内容' },
      { label: '网站资料' },
    ])
  })

  it('网站概况为单级面包屑', () => {
    expect(resolveCmsBreadcrumbs('/dashboard')).toEqual([{ label: '网站概况' }])
  })

  it('未知路径返回空列表', () => {
    expect(resolveCmsBreadcrumbs('/login')).toEqual([])
  })
})
