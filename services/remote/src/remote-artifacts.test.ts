import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Open } from 'unzipper'
import { expect, it } from 'vitest'
import { makeIsolatedDataRoot, startRemoteServer } from './test-harness.js'
import { initSiteRepository, manifestJsonForPublishedSite, pushBundleHttp, writeGitBundle } from './test-git-helpers.js'

const token = 'remote-artifact-token'

it('发布后提供404、301、授权文件和SHA-256清单，ZIP与发布文件完全一致', async () => {
  const dataRoot = await makeIsolatedDataRoot('remote-artifacts')
  const { baseUrl, close } = await startRemoteServer({ dataRoot, serviceToken: token, publicBaseUrl: 'http://127.0.0.1:0' })
  try {
    const create = await fetch(`${baseUrl}/api/remote/sites`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    const { remoteSiteId } = await create.json() as { remoteSiteId: string }
    const expected = {
      'public/index.html': '<html><head><title>Locale:en</title></head><body>网站首页</body></html>',
      'public/404.html': '<html><body>页面不存在</body></html>',
      'public/en/about/index.html': '<html><body>About</body></html>',
      'public/assets/style.css': 'body{color:#246}',
      'server-config/_redirects': '/en/previous/ /en/about/ 301\n/en/old-about/ /en/about/ 301\n/* /404.html 404\n',
      'server-config/nginx.conf': 'error_page 404 /404.html;\n',
    }
    const repoDir = path.join(dataRoot, 'repo')
    const { commitId } = await initSiteRepository(repoDir, {
      'olps.manifest.json': await manifestJsonForPublishedSite(dataRoot),
      'source/site-settings.json': JSON.stringify({ defaultLocale: 'en', locales: ['en'] }),
      ...expected,
    })
    const bundlePath = path.join(dataRoot, 'bundle/site.bundle')
    await writeGitBundle(repoDir, bundlePath)
    const push = await pushBundleHttp({ baseUrl, token, remoteSiteId, bundlePath, commitId, expectedPublishedCommitId: null })
    expect(push.status, await push.text()).toBe(200)
    const missing = await fetch(`${baseUrl}/s/${remoteSiteId}/missing/deep/`)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe(expected['public/404.html'])
    const rootRedirect=await fetch(`${baseUrl}/s/${remoteSiteId}/?utm_source=redirect-check&gclid=click%2Bid`,{redirect:'manual'})
    expect(rootRedirect.status).toBe(200)
    expect(new URL(rootRedirect.url).search).toBe('?utm_source=redirect-check&gclid=click%2Bid')
    for (const previous of ['previous', 'old-about']) {
      const redirect = await fetch(`${baseUrl}/s/${remoteSiteId}/en/${previous}/?utm_source=redirect-check&gclid=click%2Bid`, { redirect: 'manual' })
      expect(redirect.status).toBe(301)
      expect(redirect.headers.get('location')).toBe(`/s/${remoteSiteId}/en/about/?utm_source=redirect-check&gclid=click%2Bid`)
    }
    const api = `${baseUrl}/api/remote/sites/${remoteSiteId}`
    for (const endpoint of ['/artifacts', '/download.zip', '/files/public/index.html', '/files/server-config/_redirects']) {
      expect((await fetch(`${api}${endpoint}`)).status).toBe(401)
    }
    const headers = { Authorization: `Bearer ${token}` }
    const manifestResponse = await fetch(`${api}/artifacts`, { headers })
    expect(manifestResponse.status).toBe(200)
    const manifest = await manifestResponse.json() as { publishedCommitId: string; files: Array<{ path: string; sha256: string; size: number }> }
    expect(manifest.publishedCommitId).toBe(commitId)
    expect(manifest.files.map(file => file.path).sort()).toEqual(Object.keys(expected).sort())
    for (const file of manifest.files) {
      const content = Buffer.from(expected[file.path as keyof typeof expected])
      expect(file.sha256).toBe(createHash('sha256').update(content).digest('hex'))
      expect(file.size).toBe(content.length)
      const response = await fetch(`${api}/files/${file.path}`, { headers })
      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(content)
    }
    expect((await fetch(`${api}/files/source/site-settings.json`, { headers })).status).toBe(404)
    const zipped = await fetch(`${api}/download.zip`, { headers })
    expect(zipped.status).toBe(200)
    expect(zipped.headers.get('content-type')).toBe('application/zip')
    const zip = await Open.buffer(Buffer.from(await zipped.arrayBuffer()))
    const entries = zip.files.filter(file => file.type === 'File')
    expect(entries.map(file => file.path).sort()).toEqual(manifest.files.map(file => file.path).sort())
    for (const entry of entries) {
      const bytes = await entry.buffer()
      const recorded = manifest.files.find(file => file.path === entry.path)!
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(recorded.sha256)
    }
    const nextRepo = path.join(dataRoot, 'next-repo')
    const nextFiles = {
      ...expected,
      'public/index.html': '<html><head><title>Locale:en</title></head><body>新版本首页</body></html>',
      'server-config/_redirects': '/company/en/previous/ /company/en/about/ 301\n/company/en/old-about/ /company/en/about/ 301\n/company/* /company/404.html 404\n',
    }
    const next = await initSiteRepository(nextRepo, {
      'olps.manifest.json': await manifestJsonForPublishedSite(dataRoot),
      'source/site-settings.json': JSON.stringify({ defaultLocale: 'en', locales: ['en'] }),
      ...nextFiles,
    })
    const nextBundle = path.join(dataRoot, 'bundle/next.bundle')
    await writeGitBundle(nextRepo, nextBundle)
    const nextPush = await pushBundleHttp({ baseUrl, token, remoteSiteId, bundlePath: nextBundle, commitId: next.commitId, expectedPublishedCommitId: commitId })
    expect(nextPush.status, await nextPush.text()).toBe(200)
    const subdirectoryRedirect = await fetch(`${baseUrl}/s/${remoteSiteId}/en/previous/`, { redirect: 'manual' })
    expect(subdirectoryRedirect.status).toBe(301)
    expect(subdirectoryRedirect.headers.get('location')).toBe(`/s/${remoteSiteId}/en/about/`)
    const oldManifest = await fetch(`${api}/artifacts?commitId=${commitId}`, { headers })
    expect(await oldManifest.json()).toEqual(manifest)
    const oldFile = await fetch(`${api}/files/public/index.html?commitId=${commitId}`, { headers })
    expect(await oldFile.text()).toBe(expected['public/index.html'])
    const oldZip = await fetch(`${api}/download.zip?commitId=${commitId}`, { headers })
    const previousZip = await Open.buffer(Buffer.from(await oldZip.arrayBuffer()))
    expect(await previousZip.files.find(file => file.path === 'public/index.html')!.buffer()).toEqual(Buffer.from(expected['public/index.html']))
    expect((await fetch(`${api}/artifacts?commitId=invalid`, { headers })).status).toBe(400)
    expect((await fetch(`${api}/artifacts?commitId=${'a'.repeat(40)}`, { headers })).status).toBe(404)
  } finally {
    close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
