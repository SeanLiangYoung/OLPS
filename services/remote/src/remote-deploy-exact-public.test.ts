import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeIsolatedDataRoot, startRemoteServer } from './test-harness.js'
import {
  initSiteRepository,
  pushBundleHttp,
  writeGitBundle,
} from './test-git-helpers.js'

const token = 'remote-test-token'
const EXACT_PUBLIC =
  '<!DOCTYPE html><html><head><title>Locale:en</title></head><body><!--EXACT-BYTES-7f3a9c--></body></html>'

describe('远端部署公开内容与 commit 内 public 字节一致', () => {
  it('浏览器读取的 index.html 与 push 的 commit 中文件相同', async () => {
    const dataRoot = await makeIsolatedDataRoot('exact-public')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const verifyScript = path.join(dataRoot, 'sc', 'verify-exact.mjs')
      await fs.mkdir(path.dirname(verifyScript), { recursive: true })
      await fs.writeFile(
        verifyScript,
        `import fs from 'node:fs'\nconst expected = ${JSON.stringify(EXACT_PUBLIC)}\nconst html = fs.readFileSync('public/index.html','utf8')\nif (html !== expected) process.exit(4)\n`,
        'utf8',
      )
      const createRes = await fetch(`${baseUrl}/api/remote/sites`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const { remoteSiteId } = (await createRes.json()) as { remoteSiteId: string }
      const settings = JSON.stringify({ defaultLocale: 'en', locales: ['en'] })
      const verifyOnlyManifest = JSON.stringify({
        version: 1,
        verifyCommand: [process.execPath, verifyScript],
      })
      const repoDir = path.join(dataRoot, 'r', 'exact')
      const { commitId } = await initSiteRepository(repoDir, {
        'olps.manifest.json': verifyOnlyManifest,
        'source/site-settings.json': settings,
        'public/index.html': EXACT_PUBLIC,
      })
      const bundlePath = path.join(dataRoot, 'b', 'exact.bundle')
      await writeGitBundle(repoDir, bundlePath)
      const pushRes = await pushBundleHttp({
        baseUrl,
        token,
        remoteSiteId,
        bundlePath,
        commitId,
        expectedPublishedCommitId: null,
      })
      if (pushRes.status !== 200) {
        throw new Error(`push 失败 ${pushRes.status}: ${await pushRes.text()}`)
      }
      const pageRes = await fetch(`${baseUrl}/s/${remoteSiteId}/index.html`)
      expect(pageRes.status).toBe(200)
      const served = await pageRes.text()
      expect(served).toBe(EXACT_PUBLIC)
    } finally {
      close()
    }
  })
})
