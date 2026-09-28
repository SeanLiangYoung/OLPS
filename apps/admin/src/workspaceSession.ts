import { ref } from 'vue'
import type { User } from './types'

const DRAFT_KEY = 'olps_draft_id'

export const selectedDraftIdState = ref(
  typeof localStorage !== 'undefined'
    ? (localStorage.getItem(DRAFT_KEY) ?? '')
    : '',
)

export const selectedDraftNameState = ref('')

export const currentUserState = ref<User | null>(null)

export function applySelectedDraftId(draftId: string): void {
  localStorage.setItem(DRAFT_KEY, draftId)
  selectedDraftIdState.value = draftId
}

export function setCurrentUser(user: User | null): void {
  currentUserState.value = user
}

export function clearWorkspaceSession(): void {
  localStorage.removeItem(DRAFT_KEY)
  selectedDraftIdState.value = ''
  selectedDraftNameState.value = ''
  currentUserState.value = null
}
