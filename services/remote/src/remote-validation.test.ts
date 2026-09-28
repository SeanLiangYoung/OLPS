import { describe, expect, it } from 'vitest'
import {
  assertSafeGitRef,
  assertSafePublicRelativePath,
  assertValidRemoteSiteId,
} from './validation.js'

describe('远端输入校验', () => {
  it('accept 合法 UUID remoteSiteId', () => {
    expect(() =>
      assertValidRemoteSiteId('550e8400-e29b-41d4-a716-446655440000'),
    ).not.toThrow()
  })

  it('reject 含路径片段或非法字符的 remoteSiteId', () => {
    expect(() => assertValidRemoteSiteId('../etc')).toThrow(/remoteSiteId/i)
    expect(() => assertValidRemoteSiteId('not-a-uuid')).toThrow(/remoteSiteId/i)
  })

  it('reject 公开路径中的 .. 与绝对路径', () => {
    expect(() => assertSafePublicRelativePath('index.html')).not.toThrow()
    expect(() => assertSafePublicRelativePath('../.git/config')).toThrow(/路径/i)
    expect(() => assertSafePublicRelativePath('/etc/passwd')).toThrow(/路径/i)
  })

  it('reject Git 参数注入形式的 ref', () => {
    expect(() => assertSafeGitRef('main')).not.toThrow()
    expect(() => assertSafeGitRef('--upload-pack=evil')).toThrow(/ref/i)
    expect(() => assertSafeGitRef('refs/heads/main')).not.toThrow()
  })
})
