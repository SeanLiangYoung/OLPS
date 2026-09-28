import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEY_LEN = 64

export function hashPassword(plain: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(plain, salt, KEY_LEN)
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false
  }
  const salt = Buffer.from(parts[1]!, 'hex')
  const expected = Buffer.from(parts[2]!, 'hex')
  const derived = scryptSync(plain, salt, expected.length)
  if (derived.length !== expected.length) {
    return false
  }
  return timingSafeEqual(derived, expected)
}
