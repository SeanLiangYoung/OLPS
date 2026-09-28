import { describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import { sandboxRoot } from './test-helpers.js'

const dummyRemote = { baseUrl: 'http://127.0.0.1:9', token: 'test-token-unused' }

describe('SyncWorkspace listFiles 前缀递归', () => {
  it('listFiles(source/pages) 返回嵌套页面 JSON 路径', async () => {
    const ws = await SyncWorkspace.create({
      sandboxRoot: await sandboxRoot('list-files'),
      draftId: 'draft-list-files',
      remote: dummyRemote,
    })
    await ws.writeFile(
      `${SITE_PATHS.pagesDir}/home.json`,
      Buffer.from('{"id":"home"}', 'utf8'),
    )
    await ws.writeFile(
      `${SITE_PATHS.pagesDir}/nested/deep/page.json`,
      Buffer.from('{"id":"deep"}', 'utf8'),
    )
    const listed = await ws.listFiles(`${SITE_PATHS.pagesDir}`)
    expect(listed).toContain(`${SITE_PATHS.pagesDir}/home.json`)
    expect(listed).toContain(`${SITE_PATHS.pagesDir}/nested/deep/page.json`)
    expect(listed.some((p) => p.startsWith('public/'))).toBe(false)
  })
})
