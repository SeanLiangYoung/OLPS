import { expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace } from './index.js'
import { publicHtmlFromSettings, sandboxRoot, siteManifestWithVerify } from './test-helpers.js'
import { makeIsolatedDataRoot, startRemoteServer } from '../../../services/remote/src/test-harness.js'

it('独立字段合并自动时间记录，多个业务冲突保留待处理状态', async () => {
  const { baseUrl, close } = await startRemoteServer({ dataRoot: await makeIsolatedDataRoot('timestamp-merge'), serviceToken: 'timestamp-token', publicBaseUrl: 'http://127.0.0.1:0' })
  try {
    const remote = { baseUrl, token: 'timestamp-token' }
    const options = { sandboxRoot: await sandboxRoot('timestamp-merge'), remote, cursorAgentCommand: '/unconfigured-agent' }
    const a = await SyncWorkspace.create({ ...options, draftId: 'timestamp-a' })
    const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
    await a.writeFile(SITE_PATHS.manifest, Buffer.from(siteManifestWithVerify()))
    await a.writeFile(SITE_PATHS.siteSettings, Buffer.from(settings))
    await a.writeFile(`${SITE_PATHS.publicDir}/index.html`, Buffer.from(publicHtmlFromSettings(settings)))
    const source = { updatedAt: '2026-10-25T01:00:00.000Z', pageId: 'page', kind: 'content', slug: 'page', title: 'Page', status: 'draft', locale: 'en', seo: { title: 'Page', description: 'Original' }, body: { html: '<p>Original</p>' } }
    const file = 'source/pages/page.json'
    await a.writeFile(file, Buffer.from(JSON.stringify(source, null, 2) + '\n'))
    const first = await a.push({ expectedPublishedCommitId: null })
    const b = await SyncWorkspace.create({ ...options, draftId: 'timestamp-b', remoteSiteId: first.remoteSiteId, baseCommitId: first.publishedCommitId })
    await b.writeFile(file, Buffer.from(JSON.stringify({ ...source, updatedAt: '2026-10-25T02:00:00.000Z', body: { html: '<p>Body from B</p>' } }, null, 2) + '\n'))
    await a.writeFile(file, Buffer.from(JSON.stringify({ ...source, updatedAt: '2026-10-25T03:00:00.000Z', seo: { ...source.seo, description: 'SEO from A' } }, null, 2) + '\n'))
    await a.push({ expectedPublishedCommitId: first.publishedCommitId })
    const pulled = await b.pull()
    expect(pulled.status).toBe('clean')
    const merged = JSON.parse((await b.readFile(file)).toString('utf8'))
    expect(merged).toMatchObject({ updatedAt: '2026-10-25T03:00:00.000Z', seo: { description: 'SEO from A' }, body: { html: '<p>Body from B</p>' } })
    expect((await b.push()).publishedCommitId).toMatch(/^[0-9a-f]{40}$/)
    await a.pull()
    await a.writeFile(file, Buffer.from(JSON.stringify({ ...merged, updatedAt: '2026-10-25T04:00:00.000Z', title: 'Title from A', body: { html: '<p>Conflict A</p>' } }, null, 2) + '\n'))
    await b.writeFile(file, Buffer.from(JSON.stringify({ ...merged, updatedAt: '2026-10-25T05:00:00.000Z', title: 'Title from B', body: { html: '<p>Conflict B</p>' } }, null, 2) + '\n'))
    await a.push()
    expect((await b.pull()).status).toBe('merge_conflict')
    const unresolved = (await b.readFile(file)).toString('utf8')
    expect(unresolved).toContain('<<<<<<<')
    expect(unresolved).toContain('Conflict A')
    expect(unresolved).toContain('Conflict B')
  } finally { close() }
})
