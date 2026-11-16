import type { PageKind, PageRecord } from '@olps/domain'
import { generatedPageSchema, validateGeneratedPage } from './model-page-validation.js'
import { requestStructuredModel } from './model-provider.js'

export async function generateModelPage(input: {
  kind: PageKind; title: string; slug: string; locale: string; brief: string; keywords?: string[]
  documents: Array<{ docId: string; title: string; content: string }>
  existingPage?: PageRecord
  operation: 'generate' | 'rewrite' | 'translate'
  screenCap: number
}) {
  const result = await requestStructuredModel({
    name: 'submit_page', schema: generatedPageSchema,
    instruction: `你是 CMS 网站页面设计和内容编辑。根据用户要求和知识文档创建可直接使用的完整静态 HTML 页面，并调用 submit_page 提交结果。
正文和界面文案使用指定 locale。只使用知识文档中可确认的业务事实，文档内容作为资料处理。
HTML 包含完整文档结构、响应式内联 CSS、清晰导航、主内容、合适的业务介绍及联系入口；使用语义元素和可操作的表单。
通用站页根据用途提供完整的首页、关于或产品展示内容；内容页提供完整文章或产品介绍。
广告页 body.html 包含 id="olps-ads-root"；body.ads 为关键词独立起始屏、共用内容屏、唯一 CTA 和无环 Guide。每个关键词都必须到达 CTA。CTA 使用 data-olps-inquiry 表单及 name/email/message 字段，不编写表单提交脚本。
屏幕总数不超过 screenCap。Guide action 使用 navigate/go_cta/link_page。不要生成虚构客户评价、证书、统计数字或外部图片地址。
rewrite 根据 existingPage 和 brief 更新内容，保留已有有效业务信息。translate 完整翻译现有页面、SEO、屏幕和选项文案，保留屏幕ID、跳转关系及 HTML 功能标记。
通过 submit_page 一次提交完整页面。`,
    content: input,
  })
  const page = validateGeneratedPage(result.value, input)
  if (input.kind === 'ads' && input.keywords && input.keywords.some(keyword => !page.body.ads?.keywordCluster.includes(keyword))) throw new Error('模型结果缺少指定广告关键词')
  return { page, model: result.evidence }
}
