import { describe, expect, it } from 'vitest'
import { createLiquidEngine, loadLiquidTemplateFiles } from './liquid.js'
import { createNodeSourceReader } from './test-support/node-source-reader.js'
import { renderBlocksFixtureRoot } from './test-support/paths.js'

describe('Liquid 引擎', () => {
  it('目录越界读取时终止，错误含路径', async () => {
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

    await expect(
      engine.parseAndRender(`{% render '../../secret' %}`),
    ).rejects.toThrow(/secret|越界|outside|contain/i)
  })

  it('未知过滤器时终止', async () => {
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

    expect(() => engine.parse('{{ "x" | totally_unknown_filter }}')).toThrow(
      /totally_unknown_filter|filter/i,
    )
  })

  it('未知变量时终止', async () => {
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

    await expect(engine.parseAndRender('{{ totally_unknown_variable }}')).rejects.toThrow(
      /totally_unknown_variable|undefined variable/i,
    )
  })
})
