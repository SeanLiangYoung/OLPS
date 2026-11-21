import { randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
import { assertCredentialsKey, decryptCredential, encryptCredential } from './credentials.js'

it('AES-256-GCM加密不包含明文且不同范围不能解密', () => {
  const key = assertCredentialsKey(randomBytes(32).toString('base64'))
  const plaintext = 'private-plugin-secret-value'
  const cipher = encryptCredential(plaintext, 'site-a/plugin-a', key)
  expect(cipher).not.toContain(plaintext)
  expect(decryptCredential(cipher, 'site-a/plugin-a', key)).toBe(plaintext)
  expect(() => decryptCredential(cipher, 'site-b/plugin-a', key)).toThrow()
  expect(encryptCredential(plaintext, 'site-a/plugin-a', key)).not.toBe(cipher)
})

it('拒绝缺失或长度错误的凭据密钥', () => {
  expect(() => assertCredentialsKey('')).toThrow('CREDENTIALS_ENCRYPTION_KEY')
  expect(() => assertCredentialsKey(randomBytes(16).toString('base64'))).toThrow('CREDENTIALS_ENCRYPTION_KEY')
})
