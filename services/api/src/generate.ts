import type { PageKind, SeoFields } from '@olps/domain'
import { completeJson } from './ai-client.js'

export type SitePageLink = {
  title: string
  slug: string
}

export type GeneratedPageContent = {
  seo: SeoFields
  html: string
}

export type GeneratePageInput = {
  kind: PageKind
  title: string
  slug: string
  brief: string
  locale: string
  knowledge: string[]
  sitePages: SitePageLink[]
}

export type RevisePageInput = {
  kind: PageKind
  title: string
  slug: string
  locale: string
  seo: SeoFields
  html: string
  instruction: string
  sitePages: SitePageLink[]
}

const KIND_LABEL: Record<PageKind, string> = {
  site: '通用站页（首页、产品列表、关于我们、联系我们等网站骨架页面）',
  content: '内容页（产品详情、案例、文章等具体内容）',
}

const OUTPUT_FORMAT = `只输出一个 JSON 对象，格式如下：
{"seoTitle": "页面的 SEO 标题", "seoDescription": "页面的 SEO 描述", "html": "<!doctype html>...完整 HTML 文档..."}`

function htmlRules(locale: string): string {
  return `html 字段的要求：
1. 完整的 HTML5 文档，<head> 内包含 <meta charset="utf-8"> 和 <meta name="viewport" content="width=device-width, initial-scale=1">。
2. 所有样式写在 <head> 内的一个 <style> 标签里；不引用任何外部 CSS、字体、图片或脚本，不写 <script>。
3. 使用语义化标签（header、nav、main、section、article、footer），整页只有一个 <h1>，标题层级连续。
4. 正文内容直接写在 HTML 里，不依赖脚本渲染。
5. 在手机、平板、电脑宽度下都能正常阅读。
6. 页面语言为 ${locale}，所有可见文字都使用这种语言。
7. 需要访客留下联系方式时，使用 <form data-olps-inquiry>，包含 name、email、message 三个字段和一个提交按钮，并在表单内放 <p data-olps-inquiry-status role="status"></p>；form 不写 action 和 method。
8. 只能链接到下面列出的站内页面，链接写成 ../<slug>/ 的相对路径；不要编造其他站内链接。
seoTitle 不超过 60 个字符，seoDescription 不超过 160 个字符，两者都使用页面语言。`
}

function sitePagesSection(sitePages: SitePageLink[]): string {
  if (!sitePages.length) {
    return '站内页面：暂无其他页面。'
  }
  const lines = sitePages.map((p) => `- ${p.title}：../${p.slug}/`)
  return `站内页面：\n${lines.join('\n')}`
}

function requireNonEmptyString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`AI 输出缺少 ${key}`)
  }
  return value.trim()
}

function parseGeneratedPage(raw: Record<string, unknown>): GeneratedPageContent {
  return {
    seo: {
      title: requireNonEmptyString(raw, 'seoTitle'),
      description: requireNonEmptyString(raw, 'seoDescription'),
    },
    html: requireNonEmptyString(raw, 'html'),
  }
}

export async function generatePageContent(input: GeneratePageInput): Promise<GeneratedPageContent> {
  if (!input.title.trim()) throw new Error('title 不能为空')
  if (!input.brief.trim()) throw new Error('brief 不能为空')
  const system = `你是网站页面生成器，根据用户给出的页面信息生成一个完整的网页。
${OUTPUT_FORMAT}

${htmlRules(input.locale)}`
  const knowledgeSection = input.knowledge.length
    ? `参考资料（页面内容必须以这些资料为准，不要编造资料以外的事实）：\n${input.knowledge.join('\n\n')}`
    : '参考资料：无。'
  const user = `页面类型：${KIND_LABEL[input.kind]}
页面标题：${input.title}
页面 slug：${input.slug}
需求描述：${input.brief}

${sitePagesSection(input.sitePages)}

${knowledgeSection}`
  return parseGeneratedPage(await completeJson({ system, user }))
}

export async function revisePageContent(input: RevisePageInput): Promise<GeneratedPageContent> {
  if (!input.instruction.trim()) throw new Error('instruction 不能为空')
  const system = `你是网站页面编辑器，按照用户的修改指令修改一个已有网页；指令没有要求修改的内容保持原样。
${OUTPUT_FORMAT}

${htmlRules(input.locale)}`
  const user = `页面类型：${KIND_LABEL[input.kind]}
页面标题：${input.title}
页面 slug：${input.slug}
当前 SEO 标题：${input.seo.title}
当前 SEO 描述：${input.seo.description}

${sitePagesSection(input.sitePages)}

当前 HTML：
${input.html}

修改指令：${input.instruction}`
  return parseGeneratedPage(await completeJson({ system, user }))
}
