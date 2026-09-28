const TOKEN_KEY = 'olps_access_token'
const DRAFT_KEY = 'olps_draft_id'

export function getAccessToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setAccessToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function getSelectedDraftId(): string {
  return localStorage.getItem(DRAFT_KEY) ?? ''
}

export function setSelectedDraftId(draftId: string): void {
  localStorage.setItem(DRAFT_KEY, draftId)
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(DRAFT_KEY)
}
