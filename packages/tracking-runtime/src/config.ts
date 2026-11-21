import type { TrackingConfig, TrackingTexts } from './types.js'

const DEFAULT_TEXTS_ZH: TrackingTexts = {
  bannerMessage: '我们使用 Cookie 改善体验与广告效果。',
  acceptAll: '全部接受',
  rejectAll: '全部拒绝',
  customize: '自定义',
  save: '保存设置',
  necessary: '必要',
  analytics: '统计',
  advertising: '广告',
  cookieSettings: 'Cookie 设置',
}

const DEFAULT_TEXTS_EN: TrackingTexts = {
  bannerMessage: 'We use cookies to improve your experience and measure ads.',
  acceptAll: 'Accept all',
  rejectAll: 'Reject all',
  customize: 'Customize',
  save: 'Save settings',
  necessary: 'Necessary',
  analytics: 'Analytics',
  advertising: 'Advertising',
  cookieSettings: 'Cookie settings',
}

export function readTrackingConfig(): TrackingConfig {
  const node = document.getElementById('olps-tracking-config')
  if (!node || !node.textContent) {
    throw new Error('缺少 #olps-tracking-config 配置')
  }
  const parsed = JSON.parse(node.textContent) as TrackingConfig
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('olps-tracking-config 必须是 JSON 对象')
  }
  if (!parsed.connectors || typeof parsed.connectors !== 'object') {
    throw new Error('olps-tracking-config.connectors 必填')
  }
  if (typeof parsed.cookiePolicyUrl !== 'string' || parsed.cookiePolicyUrl.length === 0) {
    throw new Error('olps-tracking-config.cookiePolicyUrl 必填')
  }
  if (typeof parsed.locale !== 'string' || parsed.locale.length === 0) {
    throw new Error('olps-tracking-config.locale 必填')
  }
  if(parsed.eventCollector!==undefined){
    const collector=parsed.eventCollector
    if(!collector||typeof collector.endpoint!=='string'||!collector.endpoint||!collector.target||!['page','collection','group','item'].includes(collector.target.ref)||typeof collector.target.id!=='string'||!collector.target.id)throw new Error('原生统计配置无效')
    const endpoint=new URL(collector.endpoint,location.href)
    if(!['http:','https:'].includes(endpoint.protocol))throw new Error('原生统计服务地址无效')
  }
  return parsed
}

export function resolveTexts(config: TrackingConfig): TrackingTexts {
  const base = config.locale.toLowerCase().startsWith('zh')
    ? DEFAULT_TEXTS_ZH
    : DEFAULT_TEXTS_EN
  return {
    ...base,
    ...(config.texts ?? {}),
  }
}
