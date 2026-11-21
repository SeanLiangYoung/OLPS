import { describe, expect, it } from 'vitest'
import { resolveNavigationGuard } from './workspaceGuard'

describe('resolveNavigationGuard', () => {
  it('允许访问登录页', () => {
    expect(resolveNavigationGuard('/login', '', '', '')).toBe(true)
  })

  it('未登录时重定向到登录页', () => {
    expect(resolveNavigationGuard('/dashboard', '', '', '')).toBe('/login')
  })

  it('已登录但未选网站与编辑版本时进入网站列表', () => {
    expect(resolveNavigationGuard('/dashboard', 'token', '', '')).toBe('/sites')
    expect(resolveNavigationGuard('/sites', 'token', '', '')).toBe(true)
    expect(resolveNavigationGuard('/dashboard', 'token', 'draft-1', '')).toBe('/sites')
  })

  it('已登录且已选草稿时允许业务路由', () => {
    expect(resolveNavigationGuard('/pages', 'token', 'draft-1', 'site-1')).toBe(true)
  })
})
