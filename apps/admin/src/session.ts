import {
  applySelectedDraftId,
  clearWorkspaceSession,
  selectedDraftIdState,
} from './workspaceSession'

const TOKEN_KEY = 'olps_access_token'

export function getAccessToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setAccessToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function getSelectedDraftId(): string {
  if (selectedDraftIdState.value) return selectedDraftIdState.value
  return localStorage.getItem('olps_draft_id') ?? ''
}

export function setSelectedDraftId(draftId: string): void {
  applySelectedDraftId(draftId)
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY)
  clearWorkspaceSession()
}
