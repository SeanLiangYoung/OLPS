import { expect, it } from 'vitest'
import { missingProviderEnvironment, requireProviderEnvironment, validatePublicConnector, hashGoogleEmail, hashPhone, googleConversionTag } from './index.js'

it('缺少连接器环境变量时明确指出变量名称', () => {
  expect(missingProviderEnvironment('google', {})).toContain('GOOGLE_OAUTH_CLIENT_ID')
  expect(missingProviderEnvironment('meta', {})).toContain('META_APP_SECRET')
  expect(() => requireProviderEnvironment('google', {})).toThrow('GOOGLE_OAUTH_CLIENT_ID')
  expect(() => requireProviderEnvironment('meta', {})).toThrow('META_APP_ID')
})

it('五种ID连接器只接受对应公开ID字段', () => {
  expect(validatePublicConnector('gtm', { containerId: 'GTM-ABC123' })).toEqual({ containerId: 'GTM-ABC123' })
  expect(validatePublicConnector('tiktok', { pixelId: 'C12345678901234567890' })).toEqual({ pixelId: 'C12345678901234567890' })
  expect(validatePublicConnector('linkedin', { partnerId: '12345', conversionId: '6789' })).toEqual({ partnerId: '12345', conversionId: '6789' })
  expect(validatePublicConnector('clarity', { projectId: 'abc123' })).toEqual({ projectId: 'abc123' })
  expect(validatePublicConnector('uet', { tagId: '12345678' })).toEqual({ tagId: '12345678' })
  expect(() => validatePublicConnector('gtm', { containerId: 'GTM-ABC', accessToken: 'secret' })).toThrow()
  expect(() => validatePublicConnector('uet', { tagId: '<script>' })).toThrow()
})

it('广告标识符按Google要求规范化后进行SHA-256计算', () => {
  expect(hashGoogleEmail(' Test.User+sales@Gmail.com ')).toBe(hashGoogleEmail('testuser@gmail.com'))
  expect(hashPhone(' +1 (555) 010-1234 ')).toBe(hashPhone('+15550101234'))
  expect(() => hashPhone('5550101234')).toThrow('E.164')
})

it('通过HTML和JavaScript AST读取标准转化标签', () => {
  expect(googleConversionTag('<script>gtag("event","conversion",{send_to:"AW-123456/AbCd_123"});</script>')).toEqual({ conversionId: 'AW-123456', conversionLabel: 'AbCd_123' })
  expect(() => googleConversionTag('<script>gtag("event","conversion",{});</script>')).toThrow('转化标签')
})
