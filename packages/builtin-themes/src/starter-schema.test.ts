import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertValidSchema } from '@olps/domain'
import { listSectionDirectories, walkTextFiles } from './fs-walk.js'
import { starterThemeRoot } from './paths.js'

const REQUIRED_TEMPLATES = [
  'page.liquid',
  'page-home.liquid',
  'page-not-found.liquid',
  'page-full-width.liquid',
  'page-no-chrome.liquid',
  'collection.liquid',
  'group.liquid',
  'item.liquid',
  'item-products.liquid',
  'item-news.liquid',
] as const

const REQUIRED_PARTS = [
  'header.liquid',
  'footer.liquid',
  'breadcrumbs.liquid',
  'pagination.liquid',
  'card.liquid',
] as const

const REQUIRED_SECTIONS = [
  'hero',
  'feature-grid',
  'spec-table',
  'pricing',
  'case-studies',
  'cta',
  'stats',
  'logo-wall',
  'gallery',
  'contact-info',
] as const

describe('starter 主题 Schema 与结构', () => {
  it('theme.json 通过 theme Schema，并声明菜单与额外模板', async () => {
    const raw = JSON.parse(
      await fs.readFile(path.join(starterThemeRoot, 'theme.json'), 'utf8'),
    ) as unknown
    assertValidSchema('theme', raw, 'starter/theme.json')
    const theme = raw as {
      id: string
      menus: Array<{ id: string }>
      templates: Array<{ id: string }>
      styles: string[]
    }
    expect(theme.id).toBe('starter')
    expect(theme.menus.map((entry) => entry.id).sort()).toEqual(['footer', 'primary'])
    expect(theme.templates.map((entry) => entry.id).sort()).toEqual(['full-width', 'no-chrome'])
    expect(theme.styles.length).toBeGreaterThan(0)
  })

  it('包含全部必需模板、parts、sections、语言与资源文件', async () => {
    for (const fileName of REQUIRED_TEMPLATES) {
      await fs.access(path.join(starterThemeRoot, 'templates', fileName))
    }
    for (const fileName of REQUIRED_PARTS) {
      await fs.access(path.join(starterThemeRoot, 'parts', fileName))
    }
    const sectionNames = await listSectionDirectories(starterThemeRoot)
    expect(sectionNames).toEqual([...REQUIRED_SECTIONS].sort())
    await fs.access(path.join(starterThemeRoot, 'languages', 'en.json'))
    await fs.access(path.join(starterThemeRoot, 'languages', 'zh-CN.json'))
    await fs.access(path.join(starterThemeRoot, 'assets', 'style.css'))
  })

  it('每个 section 通过 section Schema', async () => {
    const sectionNames = await listSectionDirectories(starterThemeRoot)
    for (const sectionName of sectionNames) {
      const sectionPath = path.join(
        starterThemeRoot,
        'sections',
        sectionName,
        'section.json',
      )
      const raw = JSON.parse(await fs.readFile(sectionPath, 'utf8')) as unknown
      assertValidSchema('section', raw, `starter/sections/${sectionName}/section.json`)
      await fs.access(
        path.join(starterThemeRoot, 'sections', sectionName, 'section.liquid'),
      )
    }
  })

  it('主题目录可枚举为文本文件集合', async () => {
    const files = await walkTextFiles(starterThemeRoot)
    expect(files['theme.json']).toBeTypeOf('string')
    expect(files['templates/page.liquid']).toBeTypeOf('string')
    expect(files['languages/en.json']).toBeTypeOf('string')
  })
})
