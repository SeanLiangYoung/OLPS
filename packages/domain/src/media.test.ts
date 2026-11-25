import { describe, expect, it } from 'vitest'
import { isAllowedVideoMimeType, mediaMatchesFieldKind } from './media.js'

describe('视频媒体类型', () => {
  it('允许 mp4 与 webm', () => {
    expect(isAllowedVideoMimeType('video/mp4')).toBe(true)
    expect(isAllowedVideoMimeType('video/webm')).toBe(true)
  })

  it('非视频 mime 不能用于视频字段', () => {
    expect(isAllowedVideoMimeType('image/png')).toBe(false)
    expect(mediaMatchesFieldKind('image/png', 'video')).toBe(false)
  })
})