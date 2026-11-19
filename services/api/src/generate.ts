import type { PageBody, PageKind, SeoFields } from '@olps/domain'

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export type GenerateInput = {
  kind: PageKind
  title: string
  slug: string
  brief: string
  locale: string
}

export type GenerateOutput = {
  title: string
  slug: string
  locale: string
  seo: SeoFields
  body: PageBody
}

function shellHtml(title: string, description: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <style>
    :root { color-scheme: light; --fg:#14212b; --bg:#f7f4ef; --accent:#0f6a5a; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: "Segoe UI", "Noto Sans", sans-serif; color:var(--fg); background:linear-gradient(160deg,#f7f4ef,#e8f0ee); }
    main { max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); line-height:1.15; margin: 0 0 0.75rem; }
    p { line-height:1.6; }
    .card { background: rgba(255,255,255,0.72); border:1px solid #d7e0dc; border-radius: 16px; padding: 1.25rem; }
    a.button, button { display:inline-block; background:var(--accent); color:#fff; border:0; border-radius:999px; padding:0.7rem 1.2rem; text-decoration:none; cursor:pointer; }
    @media (max-width: 767px) { main { padding: 1.25rem 1rem 3rem; } }
  </style>
</head>
<body>
  <main>${inner}</main>
</body>
</html>`
}

function buildSitePage(input: GenerateInput): GenerateOutput {
  const description = input.brief || `${input.title} overview`
  const html = shellHtml(
    input.title,
    description,
    `<section class="card">
      <h1>${escapeHtml(input.title)}</h1>
      <p>${escapeHtml(description)}</p>
      <p><a class="button" href="/p/contact/">Contact</a></p>
    </section>`,
  )
  return {
    title: input.title,
    slug: input.slug,
    locale: input.locale,
    seo: { title: input.title, description },
    body: { html },
  }
}

function buildContentPage(input: GenerateInput): GenerateOutput {
  const description = input.brief || `${input.title} details`
  const html = shellHtml(
    input.title,
    description,
    `<article class="card">
      <h1>${escapeHtml(input.title)}</h1>
      <p>${escapeHtml(description)}</p>
    </article>`,
  )
  return {
    title: input.title,
    slug: input.slug,
    locale: input.locale,
    seo: { title: input.title, description },
    body: { html },
  }
}

/** 确定性页面生成器：按 brief 与 kind 写出完整草稿，不依赖外部 LPS 包。 */
export function generatePageContent(input: GenerateInput): GenerateOutput {
  if (!input.title.trim()) throw new Error('title 不能为空')
  if (!input.slug.trim()) throw new Error('slug 不能为空')
  if (input.kind === 'site') return buildSitePage(input)
  if (input.kind === 'content') return buildContentPage(input)
  throw new Error(`未知 kind: ${input.kind}`)
}
