export function loadScript(src: string): HTMLScriptElement {
  const existing = document.querySelector(`script[src="${src}"]`)
  if (existing instanceof HTMLScriptElement) {
    return existing
  }
  const script = document.createElement('script')
  script.async = true
  script.src = src
  document.head.appendChild(script)
  return script
}
