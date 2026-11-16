import type { AdsPayload } from '../types'
import { HtmlDocument } from './document'
import { rewritePreviewResources } from './resource-preview'

export function buildExperienceHtml(input: { html: string; ads?: AdsPayload; screenId?: string; assets: { url: string; previewUrl: string }[] }): string {
  const document = new DOMParser().parseFromString(input.html, 'text/html')
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "default-src 'none'; img-src https: http: data: blob:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'"
  document.head.prepend(policy)
  document.querySelectorAll('base,meta[http-equiv="refresh"]').forEach(element => element.remove())
  rewritePreviewResources(document, input.assets)
  if (input.ads) {
    const stage = document.createElement('main')
    stage.id = 'olps-editor-experience-stage'
    document.body.replaceChildren(stage)
    const data = document.createElement('script')
    data.id = 'olps-editor-experience-data'
    data.type = 'application/json'
    data.textContent = JSON.stringify({ ...input.ads, screens: input.ads.screens.map(screen => ({ ...screen, html: new HtmlDocument(screen.screenId === input.screenId ? input.html : screen.html).canvasHtml(input.assets) })), initialScreenId: input.screenId }).replaceAll('<', '\\u003c')
    document.body.append(data)
  }
  const runtime = document.createElement('script')
  runtime.textContent = `(${experienceRuntime.toString()})();`
  document.body.append(runtime)
  return '<!doctype html>' + document.documentElement.outerHTML
}

function experienceRuntime() {
  const notice = document.createElement('p')
  notice.setAttribute('role', 'status')
  document.body.append(notice)
  document.addEventListener('submit', event => {
    event.preventDefault()
    event.stopImmediatePropagation()
    notice.textContent = '体验模式：询盘内容不会发送。'
  }, true)
  document.addEventListener('click', event => {
    const anchor = (event.target as Element).closest('a')
    if (anchor && !anchor.getAttribute('href')?.startsWith('#')) {
      event.preventDefault()
      notice.textContent = '链接目标：' + anchor.getAttribute('href')
    }
  }, true)
  const payload = document.getElementById('olps-editor-experience-data')
  if (!payload) return
  const data = JSON.parse(payload.textContent!) as AdsPayload & { initialScreenId?: string }
  const stage = document.getElementById('olps-editor-experience-stage')!
  const panel = document.createElement('aside')
  panel.setAttribute('aria-label', 'Guide')
  panel.style.cssText = 'position:sticky;bottom:16px;margin:16px;max-width:320px;background:white;padding:16px;border:1px solid #bbb;z-index:1000;display:grid;gap:8px'
  document.body.append(panel)
  let current = data.initialScreenId || Object.values(data.guide.entryByKeyword)[0]!
  const visited: string[] = []
  function choose(option: { action: string; targetScreenId?: string; pageId?: string }) {
    if (option.action === 'link_page') { notice.textContent = '页面目标：' + option.pageId; return }
    const next = option.action === 'go_cta' ? data.screens.find(screen => screen.role === 'cta')?.screenId : option.targetScreenId
    if (!next) { notice.textContent = 'Guide 目标不存在'; return }
    visited.push(current)
    current = next
    render()
  }
  function render() {
    const screen = data.screens.find(item => item.screenId === current)
    if (!screen) { notice.textContent = '当前屏不存在'; return }
    stage.innerHTML = screen.html
    stage.setAttribute('data-screen-id', current)
    panel.replaceChildren()
    const title = document.createElement('strong')
    title.textContent = screen.title
    panel.append(title)
    for (const option of data.guide.nodes[current]?.options || []) {
      const button = document.createElement('button')
      button.textContent = option.label
      button.type = 'button'
      button.onclick = () => choose(option)
      panel.append(button)
    }
    if (visited.length) {
      const button = document.createElement('button')
      button.textContent = '返回上一屏'
      button.onclick = () => { current = visited.pop()!; render() }
      panel.append(button)
    }
    stage.querySelectorAll('[data-guide-option],[data-olps-guide-option]').forEach(element => {
      element.addEventListener('click', event => {
        event.preventDefault()
        const id = element.getAttribute('data-guide-option') || element.getAttribute('data-olps-guide-option')
        const option = data.guide.nodes[current]?.options.find(item => item.id === id)
        if (option) choose(option)
      })
    })
  }
  render()
}
