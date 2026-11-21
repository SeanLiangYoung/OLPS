import { createHash } from 'node:crypto'

export function hashGoogleEmail(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error('邮箱格式无效')
  let [local, domain] = normalized.split('@')
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.split('+')[0].replaceAll('.', '')
  return createHash('sha256').update(`${local}@${domain}`).digest('hex')
}

export function hashPhone(value: string): string {
  if (!/^\+[\d ()-]+$/.test(value.trim())) throw new Error('电话号码必须包含E.164国际区号')
  const normalized = value.trim().replace(/[ ()-]/g, '')
  if (!/^\+[1-9]\d{6,14}$/.test(normalized)) throw new Error('电话号码必须符合E.164格式')
  return createHash('sha256').update(normalized).digest('hex')
}
