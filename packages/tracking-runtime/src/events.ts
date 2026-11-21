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
        return
      }
      if(anchor.hasAttribute('download')){emit('download_click',{href:anchor.href});return}
      if(anchor.hasAttribute('data-olps-whatsapp-button'))return
      const url=new URL(anchor.href,location.href)
      if(['http:','https:'].includes(url.protocol)&&url.origin!==location.origin)emit('outbound_click',{href:url.href})
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
  const depths=new Set<number>()
  let queued=false
  const inspectDepth=()=>{
    queued=false
    const available=document.documentElement.scrollHeight-window.innerHeight
    if(available<=0)return
    const depth=Math.min(100,Math.round(window.scrollY/available*100))
    for(const threshold of [25,50,75,100])if(depth>=threshold&&!depths.has(threshold)){depths.add(threshold);emit('scroll_depth',{percent:threshold})}
  }
  window.addEventListener('scroll',()=>{if(!queued){queued=true;requestAnimationFrame(inspectDepth)}},{passive:true})
}

export function createOlpsGlobal(getConsent: () => ReturnType<OlpsGlobal['getConsent']>): OlpsGlobal {
  return {
    on,
    emit,
    getAttribution,
    getConsent,
  }
}
