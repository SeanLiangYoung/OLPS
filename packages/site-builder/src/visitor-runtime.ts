import type { SiteSettings } from '@olps/domain'
import { injectBeforeBodyClose } from './html-document.js'
import type { PublishConfig, StoredPageJson } from './types.js'

export function escapeVisitorHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function applyVisitorSettings(html: string, page: StoredPageJson, settings: SiteSettings, config: PublishConfig): string {
  const additions: string[] = []
  if (settings.mapsEnabled) {
    if (!settings.mapsApiKey.trim() || !settings.mapsQuery?.trim()) throw new Error('启用地图需要 mapsApiKey 和 mapsQuery')
    const params = new URLSearchParams({ key: settings.mapsApiKey, q: settings.mapsQuery })
    additions.push(`<iframe data-olps-map title="Location" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${escapeVisitorHtml(`https://www.google.com/maps/embed/v1/place?${params}`)}"></iframe>`)
  }
  if (settings.whatsappEnabled) {
    const number = settings.whatsappNumber.replace(/[+\s()-]/g, '')
    if (!/^[1-9]\d{6,14}$/.test(number)) throw new Error('whatsappNumber 需要有效国际电话号码')
    additions.push(`<a data-olps-whatsapp href="https://wa.me/${number}" target="_blank" rel="noopener noreferrer">${escapeVisitorHtml(settings.whatsappLabel)}</a>`)
  }
  if (settings.analyticsEnabled && config.siteId && config.publicApiBaseUrl) {
    const endpoint = `${config.publicApiBaseUrl.replace(/\/+$/, '')}/api/public/${encodeURIComponent(config.siteId)}/events`
    const payload = JSON.stringify({ endpoint, pageId: page.pageId }).replaceAll('<', '\\u003c')
    additions.push(`<script id="olps-visitor-runtime">
(() => {
  const config = ${payload};
  async function record(name, payload = {}) {
    const response = await fetch(config.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true, body: JSON.stringify({ name, pageId: config.pageId, payload: { path: location.pathname, ...payload } }) });
    if (!response.ok) throw new Error('Analytics request failed: ' + response.status);
  }
  void record('page_view');
  document.addEventListener('click', event => {
    const element = event.target instanceof Element ? event.target.closest('a,button,[data-olps-event]') : null;
    if (!element) return;
    const name = element.hasAttribute('data-olps-whatsapp') ? 'whatsapp_click' : element.getAttribute('data-olps-event') || 'click';
    void record(name, { label: element.textContent.trim(), href: element.getAttribute('href') });
  });
  document.addEventListener('submit', event => {
    if (event.target instanceof Element && event.target.matches('[data-olps-inquiry]')) void record('inquiry_submit');
  });
})();
</script>`)
  }
  return additions.length ? injectBeforeBodyClose(html, additions.join('\n')) : html
}
