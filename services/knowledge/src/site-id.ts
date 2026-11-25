const SITE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

export class InvalidSiteIdError extends Error {
  readonly kind = 'invalid_site_id' as const
}

export function isLegalSiteId(siteId: string): boolean {
  if (siteId.length === 0) {
    return false
  }
  if (siteId.includes('..') || siteId.includes('/') || siteId.includes('\\')) {
    return false
  }
  if (siteId.trim() !== siteId) {
    return false
  }
  return SITE_ID_PATTERN.test(siteId)
}

export function assertLegalSiteId(siteId: string): void {
  if (!isLegalSiteId(siteId)) {
    throw new InvalidSiteIdError(`illegal siteId: ${JSON.stringify(siteId)}`)
  }
}