import type { PageRole } from './content.js'

export type RequiredPageDefinition = {
  role: PageRole
  name: {
    en: string
    'zh-CN': string
  }
  defaultSlug: string
  noindex: boolean
  includeInSitemap: boolean
}

export const requiredPages: readonly RequiredPageDefinition[] = [
  {
    role: 'home',
    name: { en: 'Home', 'zh-CN': '首页' },
    defaultSlug: '',
    noindex: false,
    includeInSitemap: true,
  },
  {
    role: 'about',
    name: { en: 'About', 'zh-CN': '关于我们' },
    defaultSlug: 'about',
    noindex: false,
    includeInSitemap: true,
  },
  {
    role: 'contact',
    name: { en: 'Contact', 'zh-CN': '联系我们' },
    defaultSlug: 'contact',
    noindex: false,
    includeInSitemap: true,
  },
  {
    role: 'privacy',
    name: { en: 'Privacy Policy', 'zh-CN': '隐私政策' },
    defaultSlug: 'privacy-policy',
    noindex: false,
    includeInSitemap: true,
  },
  {
    role: 'terms',
    name: { en: 'Terms of Service', 'zh-CN': '服务条款' },
    defaultSlug: 'terms',
    noindex: false,
    includeInSitemap: true,
  },
  {
    role: 'cookies',
    name: { en: 'Cookie Policy', 'zh-CN': 'Cookie 政策' },
    defaultSlug: 'cookie-policy',
    noindex: false,
    includeInSitemap: true,
  },
  {
    role: 'thank-you',
    name: { en: 'Thank You', 'zh-CN': '询盘提交成功' },
    defaultSlug: 'thank-you',
    noindex: true,
    includeInSitemap: false,
  },
  {
    role: 'not-found',
    name: { en: 'Page Not Found', 'zh-CN': '页面未找到' },
    defaultSlug: '',
    noindex: true,
    includeInSitemap: false,
  },
] as const
