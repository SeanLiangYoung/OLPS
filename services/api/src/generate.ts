import type { AdsPayload, PageBody, PageKind, SeoFields } from '@olps/domain'

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
  keywords?: string[]
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

function buildAdsPage(input: GenerateInput): GenerateOutput {
  const keywords = input.keywords?.length ? input.keywords : ['keyword-one', 'keyword-two']
  if (keywords.length < 2) {
    throw new Error('广告页至少需要 2 个关键词')
  }
  const description = input.brief || `Landing for ${keywords.join(', ')}`
  const screens = [
    {
      screenId: 'entry-0',
      role: 'entry' as const,
      title: `${keywords[0]} start`,
      html: `<h2>${escapeHtml(keywords[0]!)}</h2><p>${escapeHtml(description)}</p>`,
      entryFor: [keywords[0]!],
    },
    {
      screenId: 'entry-1',
      role: 'entry' as const,
      title: `${keywords[1]} start`,
      html: `<h2>${escapeHtml(keywords[1]!)}</h2><p>${escapeHtml(description)}</p>`,
      entryFor: [keywords[1]!],
    },
    {
      screenId: 'shared-proof',
      role: 'content' as const,
      title: 'Shared proof',
      html: `<h2>Why teams choose us</h2><p>Shared content screen for the whole keyword cluster.</p>`,
    },
    {
      screenId: 'cta',
      role: 'cta' as const,
      title: 'Inquiry',
      html: `<h2>Send an inquiry</h2>
<form data-olps-inquiry>
  <label>Name <input name="name" required /></label>
  <label>Email <input name="email" type="email" required /></label>
  <label>Message <textarea name="message" required></textarea></label>
  <button type="submit">Submit</button>
  <p data-olps-inquiry-status role="status"></p>
</form>`,
    },
  ]

  // 第三个及以后的关键词复用 entry-0 作为额外入口映射时需独立 entry 屏；MVP 仅保证前两个独立 entry
  const entryByKeyword: Record<string, string> = {
    [keywords[0]!]: 'entry-0',
    [keywords[1]!]: 'entry-1',
  }
  for (let i = 2; i < keywords.length; i++) {
    const id = `entry-${i}`
    screens.splice(screens.length - 2, 0, {
      screenId: id,
      role: 'entry',
      title: `${keywords[i]} start`,
      html: `<h2>${escapeHtml(keywords[i]!)}</h2><p>${escapeHtml(description)}</p>`,
      entryFor: [keywords[i]!],
    })
    entryByKeyword[keywords[i]!] = id
  }

  const guideNodes: AdsPayload['guide']['nodes'] = {
    'entry-0': {
      options: [
        { id: 'e0-proof', label: 'See proof', action: 'navigate', targetScreenId: 'shared-proof' },
        { id: 'e0-cta', label: 'Inquire now', action: 'go_cta' },
        {
          id: 'e0-pivot',
          label: `Also interested in ${keywords[1]}`,
          action: 'navigate',
          targetScreenId: 'entry-1',
        },
      ],
    },
    'entry-1': {
      options: [
        { id: 'e1-proof', label: 'See proof', action: 'navigate', targetScreenId: 'shared-proof' },
        { id: 'e1-cta', label: 'Inquire now', action: 'go_cta' },
      ],
    },
    'shared-proof': {
      options: [{ id: 'proof-cta', label: 'Inquire', action: 'go_cta' }],
    },
    cta: { options: [] },
  }

  for (let i = 2; i < keywords.length; i++) {
    const id = `entry-${i}`
    guideNodes[id] = {
      options: [
        { id: `${id}-proof`, label: 'See proof', action: 'navigate', targetScreenId: 'shared-proof' },
        { id: `${id}-cta`, label: 'Inquire now', action: 'go_cta' },
      ],
    }
  }

  const ads: AdsPayload = {
    keywordCluster: keywords,
    screens,
    guide: { entryByKeyword, nodes: guideNodes },
  }

  const shell = shellHtml(
    input.title,
    description,
    `<div id="olps-ads-root" data-olps-ads="1"></div>`,
  )

  return {
    title: input.title,
    slug: input.slug,
    locale: input.locale,
    seo: { title: input.title, description },
    body: { html: shell, ads },
  }
}

/** 确定性页面生成器：按 brief 与 kind 写出完整草稿，不依赖外部 LPS 包。 */
export function generatePageContent(input: GenerateInput): GenerateOutput {
  if (!input.title.trim()) throw new Error('title 不能为空')
  if (!input.slug.trim()) throw new Error('slug 不能为空')
  if (input.kind === 'site') return buildSitePage(input)
  if (input.kind === 'content') return buildContentPage(input)
  if (input.kind === 'ads') return buildAdsPage(input)
  throw new Error(`未知 kind: ${input.kind}`)
}
