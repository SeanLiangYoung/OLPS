import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from '@vue/compiler-sfc'

describe('Google 集成操作界面', () => {
  const source = readFileSync(join(import.meta.dirname, 'pages/IntegrationsPage.vue'), 'utf8')
  it('连接通过服务端 OAuth，资源绑定不会直接设置连接状态', () => {
    expect(source).toContain('/authorize')
    expect(source).toContain('/resources')
    expect(source).not.toContain('form.value.adsConnected = true')
    expect(source).not.toContain('form.value.gaConnected = true')
    expect(source).toContain('window.confirm')
  })
  it('提供真实报告查询与 Ads 分页操作', () => {
    expect(source).toContain('/analytics')
    expect(source).toContain('/ads')
    expect(source).toContain('nextPageToken')
    expect(parse(source).errors).toEqual([])
  })
})
