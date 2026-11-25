import { describe, expect, it } from 'vitest'
import type { BlockNode } from '@olps/domain'
import { createLiquidEngine, loadLiquidTemplateFiles } from '../liquid.js'
import { createFilterRuntime, registerFilters } from '../filters.js'
import { createNodeSourceReader } from '../test-support/node-source-reader.js'
import { renderBlocksFixtureRoot } from '../test-support/paths.js'
import { loadBlockRegistry } from './registry.js'
import { renderBlockTree, BlockRenderError } from './render-tree.js'

const MEDIA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VIDEO_MEDIA_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const POSTER_MEDIA_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const IMAGE_AS_VIDEO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

async function createRenderEnv() {
  const reader = createNodeSourceReader(renderBlocksFixtureRoot)
  const files = await loadLiquidTemplateFiles(reader, {
    themeRoot: 'themes/minimal',
    pluginRoots: ['plugins/sample'],
  })
  const engine = createLiquidEngine({
    files,
    roots: {
      themeRoot: 'themes/minimal',
      pluginRoots: ['plugins/sample'],
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
        mimeType: 'image/png',
      },
      [VIDEO_MEDIA_ID]: {
        path: 'assets/uploads/2026/11/demo.mp4',
        width: 1920,
        height: 1080,
        mimeType: 'video/mp4',
      },
      [POSTER_MEDIA_ID]: {
        path: 'assets/uploads/2026/11/poster.webp',
        width: 1280,
        height: 720,
        mimeType: 'image/webp',
      },
      [IMAGE_AS_VIDEO_ID]: {
        path: 'assets/uploads/2026/11/not-a-video.png',
        width: 800,
        height: 600,
        mimeType: 'image/png',
      },
    },
    strings: {
      'cta.learn_more': 'Learn more',
    },
    resolveLink: (value) => {
      if (
        typeof value === 'object'
        && value !== null
        && 'kind' in value
        && (value as { kind: string }).kind === 'external'
      ) {
        return (value as { url: string }).url
      }
      return '../about/'
    },
  })
  registerFilters(engine, runtime)
  const registry = await loadBlockRegistry(reader, {
    themeId: 'minimal',
    enabledPluginIds: ['sample'],
  })
  return { engine, registry, runtime }
}

function block(
  id: string,
  type: string,
  props: Record<string, unknown>,
  children: BlockNode[] = [],
): BlockNode {
  return { id, type, props, children }
}

describe('核心区块渲染', () => {
  it('渲染 core/text', async () => {
    const env = await createRenderEnv()
    const html = await renderBlockTree(
      [
        block('b-text', 'core/text', {
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Hello text' }],
              },
            ],
          },
        }),
      ],
      {
        objectPath: 'source/pages/demo/en.json',
        engine: env.engine,
        registry: env.registry,
        filterRuntime: env.runtime,
      },
    )
    expect(html).toContain('Hello text')
  })

  it('渲染 core/heading', async () => {
    const env = await createRenderEnv()
    const html = await renderBlockTree(
      [block('b-heading', 'core/heading', { text: 'Title', level: 2 })],
      {
        objectPath: 'source/pages/demo/en.json',
        engine: env.engine,
        registry: env.registry,
        filterRuntime: env.runtime,
      },
    )
    expect(html).toMatch(/<h2[^>]*>Title<\/h2>/)
  })

  it('渲染 core/video', async () => {
    const env = await createRenderEnv()
    const html = await renderBlockTree(
      [
        block('b-video', 'core/video', {
          video: { mediaId: VIDEO_MEDIA_ID },
          poster: { mediaId: POSTER_MEDIA_ID },
          caption: 'Product demo',
          controls: true,
          autoplay: false,
          muted: true,
        }),
      ],
      {
        objectPath: 'source/pages/demo/en.json',
        engine: env.engine,
        registry: env.registry,
        filterRuntime: env.runtime,
      },
    )
    expect(html).toContain('/assets/uploads/2026/11/demo.mp4')
    expect(html).toContain('/assets/uploads/2026/11/poster.webp')
    expect(html).toContain('Product demo')
    expect(html).toContain('controls')
  })

  it('渲染 core/image', async () => {
    const env = await createRenderEnv()
    const html = await renderBlockTree(
      [
        block('b-image', 'core/image', {
          image: { mediaId: MEDIA_ID },
          alt: 'Hero',
        }),
      ],
      {
        objectPath: 'source/pages/demo/en.json',
        engine: env.engine,
        registry: env.registry,
        filterRuntime: env.runtime,
      },
    )
    expect(html).toContain('/assets/uploads/2026/11/hero.png')
    expect(html).toContain('Hero')
  })

  it('渲染 core/button', async () => {
    const env = await createRenderEnv()
    const html = await renderBlockTree(
      [
        block('b-button', 'core/button', {
          label: 'Go',
          link: {
            kind: 'external',
            url: 'https://example.com',
            newWindow: true,
          },
        }),
      ],
      {
        objectPath: 'source/pages/demo/en.json',
        engine: env.engine,
        registry: env.registry,
        filterRuntime: env.runtime,
      },
    )
    expect(html).toContain('Go')
    expect(html).toContain('https://example.com')
  })

  it('渲染 core/columns', async () => {
    const env = await createRenderEnv()
    const html = await renderBlockTree(
      [
        block(
          'b-columns',
          'core/columns',
          { columns: 2 },
          [
            block('b-columns-a', 'core/heading', { text: 'Left', level: 3 }),
            block('b-columns-b', 'core/heading', { text: 'Right', level: 3 }),
          ],
        ),
      ],
      {
        objectPath: 'source/pages/demo/en.json',
        engine: env.engine,
        registry: env.registry,
        filterRuntime: env.runtime,
      },
    )
    expect(html).toContain('Left')
    expect(html).toContain('Right')
    expect(html).toContain('olps-columns')
  })

  it('渲染 core/collection-list', async () => {
    const env = await createRenderEnv()
    const html = await renderBlockTree(
      [
        block('b-list', 'core/collection-list', {
          collectionId: '22222222-2222-4222-8222-222222222201',
          pageSize: 10,
          sort: 'manual',
        }),
      ],
      {
        objectPath: 'source/pages/demo/en.json',
        engine: env.engine,
        registry: env.registry,
        filterRuntime: env.runtime,
        listItems: [
          { title: 'Item One', url: '../news/item-one/' },
          { title: 'Item Two', url: '../news/item-two/' },
        ],
      },
    )
    expect(html).toContain('Item One')
    expect(html).toContain('Item Two')
  })

  it('渲染 core/faq', async () => {
    const env = await createRenderEnv()
    const html = await renderBlockTree(
      [
        block('b-faq', 'core/faq', {
          items: [
            { question: 'Q1', answer: 'A1' },
            { question: 'Q2', answer: 'A2' },
          ],
        }),
      ],
      {
        objectPath: 'source/pages/demo/en.json',
        engine: env.engine,
        registry: env.registry,
        filterRuntime: env.runtime,
      },
    )
    expect(html).toContain('Q1')
    expect(html).toContain('A2')
  })

  it('渲染 core/html 原样输出', async () => {
    const env = await createRenderEnv()
    const html = await renderBlockTree(
      [
        block('b-html', 'core/html', {
          html: '<div class="raw"><em>Keep</em></div>',
        }),
      ],
      {
        objectPath: 'source/pages/demo/en.json',
        engine: env.engine,
        registry: env.registry,
        filterRuntime: env.runtime,
      },
    )
    expect(html).toContain('<div class="raw"><em>Keep</em></div>')
  })
})

describe('区块渲染失败', () => {
  it('core/video 缺少 video 时校验失败', async () => {
    const env = await createRenderEnv()
    await expect(
      renderBlockTree(
        [block('b-video-missing', 'core/video', { caption: 'No video' })],
        {
          objectPath: 'source/pages/demo/en.json',
          engine: env.engine,
          registry: env.registry,
          filterRuntime: env.runtime,
        },
      ),
    ).rejects.toThrow(/props 校验失败|video/)
  })

  it('core/video 引用非视频媒体时终止', async () => {
    const env = await createRenderEnv()
    await expect(
      renderBlockTree(
        [
          block('b-video-bad-mime', 'core/video', {
            video: { mediaId: IMAGE_AS_VIDEO_ID },
          }),
        ],
        {
          objectPath: 'source/pages/demo/en.json',
          engine: env.engine,
          registry: env.registry,
          filterRuntime: env.runtime,
        },
      ),
    ).rejects.toThrow(/mp4|webm|视频/)
  })

  it('未知区块时终止，错误含区块 ID', async () => {
    const env = await createRenderEnv()
    await expect(
      renderBlockTree(
        [block('b-unknown', 'theme/missing-section', { heading: 'x' })],
        {
          objectPath: 'source/pages/demo/en.json',
          engine: env.engine,
          registry: env.registry,
          filterRuntime: env.runtime,
        },
      ),
    ).rejects.toThrow(BlockRenderError)

    try {
      await renderBlockTree(
        [block('b-unknown', 'theme/missing-section', { heading: 'x' })],
        {
          objectPath: 'source/pages/demo/en.json',
          engine: env.engine,
          registry: env.registry,
          filterRuntime: env.runtime,
        },
      )
    } catch (error) {
      expect(error).toBeInstanceOf(BlockRenderError)
      expect((error as Error).message).toContain('b-unknown')
      expect((error as Error).message).toContain('source/pages/demo/en.json')
    }
  })

  it('非法 children 时终止，错误含区块 ID', async () => {
    const env = await createRenderEnv()
    await expect(
      renderBlockTree(
        [
          block(
            'b-text-parent',
            'core/text',
            {
              content: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'no children' }],
                  },
                ],
              },
            },
            [block('b-child', 'core/heading', { text: 'Nope', level: 2 })],
          ),
        ],
        {
          objectPath: 'source/pages/demo/en.json',
          engine: env.engine,
          registry: env.registry,
          filterRuntime: env.runtime,
        },
      ),
    ).rejects.toThrow(/b-text-parent|children|accepts/i)
  })

  it('注册主题与已启用插件区块', async () => {
    const env = await createRenderEnv()
    expect(env.registry.has('theme/hero')).toBe(true)
    expect(env.registry.has('plugin/sample/note')).toBe(true)

    const html = await renderBlockTree(
      [block('b-hero', 'theme/hero', { heading: 'Hero Title' })],
      {
        objectPath: 'source/pages/demo/en.json',
        engine: env.engine,
        registry: env.registry,
        filterRuntime: env.runtime,
      },
    )
    expect(html).toContain('Hero Title')
  })
})
