import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertValidSchema } from '@olps/domain'
import { builtinPluginIds, pluginRoot } from './paths.js'

const EXPECTED_SECTIONS: Record<(typeof builtinPluginIds)[number], string> = {
  'inquiry-form': 'form',
  whatsapp: 'button',
  'google-maps': 'map',
}

describe('内置插件 Schema 与结构', () => {
  for (const pluginId of builtinPluginIds) {
    it(`${pluginId} 的 plugin.json 与 section 通过 Schema`, async () => {
      const root = pluginRoot(pluginId)
      const pluginJsonPath = path.join(root, 'plugin.json')
      const pluginRaw = JSON.parse(await fs.readFile(pluginJsonPath, 'utf8')) as {
        id: string
      }
      assertValidSchema('plugin', pluginRaw, `${pluginId}/plugin.json`)
      expect(pluginRaw.id).toBe(pluginId)

      const sectionName = EXPECTED_SECTIONS[pluginId]
      const sectionJsonPath = path.join(root, 'sections', sectionName, 'section.json')
      const sectionRaw = JSON.parse(await fs.readFile(sectionJsonPath, 'utf8')) as unknown
      assertValidSchema(
        'section',
        sectionRaw,
        `${pluginId}/sections/${sectionName}/section.json`,
      )
      await fs.access(path.join(root, 'sections', sectionName, 'section.liquid'))
      await fs.access(path.join(root, 'languages', 'en.json'))
      await fs.access(path.join(root, 'languages', 'zh-CN.json'))
    })
  }

  it('whatsapp 提供 snippet 与区块类型 plugin/whatsapp/button', async () => {
    const root = pluginRoot('whatsapp')
    const pluginRaw = JSON.parse(
      await fs.readFile(path.join(root, 'plugin.json'), 'utf8'),
    ) as {
      snippets: Array<{ file: string }>
    }
    expect(pluginRaw.snippets.length).toBeGreaterThan(0)
    await fs.access(path.join(root, 'snippets', 'button.liquid'))
    await fs.access(path.join(root, 'sections', 'button', 'section.liquid'))
  })
})
