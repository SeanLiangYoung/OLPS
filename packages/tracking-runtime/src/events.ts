import type { EventHandler, EventPayload, OlpsGlobal } from './types.js'
import { getAttribution } from './attribution.js'

const listeners = new Map<string, Set<EventHandler>>()

function createEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  throw new Error('当前浏览器不支持 crypto.randomUUID')
}

export function on(event: string, handler: EventHandler): void {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  set.add(handler)
}

export function emit(event: string, payload: Record<string, unknown> = {}): EventPayload {
  const body: EventPayload = {
    ...payload,
    event_id: typeof payload.event_id === 'string' ? payload.event_id : createEventId(),
  }
  const set = listeners.get(event)
  if (set) {
    for (const handler of set) {
      handler(body)
    }
  }
  const wildcard = listeners.get('*')
  if (wildcard) {
    for (const handler of wildcard) {
      handler({ ...body, event: event })
    }
  }
  return body
}

export function installAutoEvents(): void {
  const startedForms = new WeakSet<HTMLFormElement>()

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a')
      if (!(anchor instanceof HTMLAnchorElement)) return
      const href = anchor.getAttribute('href') ?? ''
      if (href.startsWith('tel:')) {
        emit('phone_click', { href })
        return
      }
      if (href.startsWith('mailto:')) {
        emit('email_click', { href })
      }
    },
    true,
  )

  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const form = target.closest('form')
      if (!(form instanceof HTMLFormElement)) return
      if (startedForms.has(form)) return
      startedForms.add(form)
      emit('form_start', { formId: form.id || undefined })
    },
    true,
  )
}

export function createOlpsGlobal(getConsent: () => ReturnType<OlpsGlobal['getConsent']>): OlpsGlobal {
  return {
    on,
    emit,
    getAttribution,
    getConsent,
  }
}
