import { describe, expect, it } from 'vitest'
import { createLiquidEngine, loadLiquidTemplateFiles } from './liquid.js'
import { createFilterRuntime, registerFilters } from './filters.js'
import { createNodeSourceReader } from './test-support/node-source-reader.js'
import { renderBlocksFixtureRoot } from './test-support/paths.js'

const MEDIA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('Liquid 过滤器', () => {
  it('asset_url、media_url、image_srcset、t、format_date、format_number 可用', async () => {
    const reader = createNodeSourceReader(renderBlocksFixtureRoot)
    const files = await loadLiquidTemplateFiles(reader, {
      themeRoot: 'themes/minimal',
      pluginRoots: [],
    })
    const engine = createLiquidEngine({
      files,
      roots: {
        themeRoot: 'themes/minimal',
        pluginRoots: [],
      },
    })
    const runtime = createFilterRuntime({
      locale: 'en',
      themeId: 'minimal',
      assetHashes: {
        'style.css': 'style.abc123.css',
      },
      mediaById: {
        [MEDIA_ID]: {
          path: 'assets/uploads/2026/11/hero.png',
          width: 1200,
          height: 800,
        },
      },
      strings: {
        'cta.learn_more': 'Learn more',
      },
      resolveLink: () => '../about/',
    })
    registerFilters(engine, runtime)

    const html = await engine.parseAndRender(
      [
        '{{ "style.css" | asset_url }}',
        '{{ media | media_url }}',
        '{{ media | image_srcset }}',
        '{{ "cta.learn_more" | t }}',
        '{{ "2026-11-20" | format_date }}',
        '{{ 1234.5 | format_number }}',
      ].join('\n'),
      {
        media: { mediaId: MEDIA_ID },
      },
    )

    expect(html).toContain('/assets/theme/minimal/style.abc123.css')
    expect(html).toContain('/assets/uploads/2026/11/hero.png')
    expect(html).toMatch(/480w/)
    expect(html).toContain('Learn more')
    expect(html.length).toBeGreaterThan(20)
  })

  it('link 过滤器解析站内引用', async () => {
    const reader = createNodeSourceReader(renderBlocksFixtureRoot)
    const files = await loadLiquidTemplateFiles(reader, {
      themeRoot: 'themes/minimal',
      pluginRoots: [],
    })
    const engine = createLiquidEngine({
      files,
      roots: {
        themeRoot: 'themes/minimal',
        pluginRoots: [],
      },
    })
    const runtime = createFilterRuntime({
      locale: 'en',
      themeId: 'minimal',
      assetHashes: {},
      mediaById: {},
      strings: {},
      resolveLink: (value) => {
        if (
          typeof value === 'object'
          && value !== null
          && 'kind' in value
          && (value as { kind: string }).kind === 'external'
        ) {
          return (value as { url: string }).url
        }
        return '../contact/'
      },
    })
    registerFilters(engine, runtime)

    const html = await engine.parseAndRender('{{ link | link }}', {
      link: {
        kind: 'internal',
        target: { ref: 'page', id: '11111111-1111-4111-8111-111111111103' },
      },
    })
    expect(html.trim()).toBe('../contact/')
  })
})
