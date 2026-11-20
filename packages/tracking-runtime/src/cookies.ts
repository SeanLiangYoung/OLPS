const DAY_SECONDS = 24 * 60 * 60

export function writeCookie(name: string, value: string, maxAgeDays: number): void {
  const encoded = encodeURIComponent(value)
  const maxAge = maxAgeDays * DAY_SECONDS
  document.cookie = `${name}=${encoded}; path=/; max-age=${maxAge}; SameSite=Lax`
}

export function readCookie(name: string): string | null {
  const parts = document.cookie.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed.startsWith(`${name}=`)) continue
    return decodeURIComponent(trimmed.slice(name.length + 1))
  }
  return null
}

export function writeJsonCookie(name: string, value: unknown, maxAgeDays: number): void {
  writeCookie(name, JSON.stringify(value), maxAgeDays)
}

export function readJsonCookie<T>(name: string): T | null {
  const raw = readCookie(name)
  if (raw === null) return null
  return JSON.parse(raw) as T
}
