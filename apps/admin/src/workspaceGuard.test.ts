import { describe, expect, it } from 'vitest'
import { resolveNavigationGuard } from './workspaceGuard'

describe('resolveNavigationGuard', () => {
  it('允许访问登录页', () => {
    expect(resolveNavigationGuard('/login', '', '')).toBe(true)
  })

  it('未登录时重定向到登录页', () => {
    expect(resolveNavigationGuard('/dashboard', '', '')).toBe('/login')
  })

  it('已登录但未选草稿时进入工作区选择页', () => {
    expect(resolveNavigationGuard('/dashboard', 'token', '')).toBe('/workspace')
    expect(resolveNavigationGuard('/workspace', 'token', '')).toBe(true)
  })

  it('已登录且已选草稿时允许业务路由', () => {
    expect(resolveNavigationGuard('/pages', 'token', 'draft-1')).toBe(true)
  })
})
