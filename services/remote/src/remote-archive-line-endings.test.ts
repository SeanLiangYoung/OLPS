import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractCommitToDir, ensureBareRepo, fetchBundleToCandidateRef, promoteCommitToMain } from './git-store.js'
import { makeIsolatedDataRoot, startRemoteServer } from './test-harness.js'
import {
  initSiteRepository,
  pushBundleHttp,
  writeGitBundle,
} from './test-git-helpers.js'

const token = 'remote-test-token'

const MULTILINE_HTML = [
  '<!DOCTYPE html>',
  '<html>',
  '<head><title>Locale:en</title></head>',
  '<body data-marker="lf-bytes-7c2e">',
  '  line-two',
  '</body>',
  '</html>',
  '',
].join('\n')

describe('git archive 换行字节', () => {
  it('extractCommitToDir 导出多行 HTML 与 commit 内 blob 字节一致', async () => {
    const dataRoot = await makeIsolatedDataRoot('archive-lf')
    const repoDir = path.join(dataRoot, 'src-repo')
    const bareDir = path.join(dataRoot, 'bare')
    const { commitId } = await initSiteRepository(repoDir, {
      'olps.manifest.json': JSON.stringify({ version: 1 }),
      'source/site-settings.json': JSON.stringify({ defaultLocale: 'en', locales: ['en'] }),
      'public/index.html': MULTILINE_HTML,
    })
    const bundlePath = path.join(dataRoot, 'snap.bundle')
    await writeGitBundle(repoDir, bundlePath)
    await ensureBareRepo(bareDir)
    const candidateRef = await fetchBundleToCandidateRef(bareDir, bundlePath, commitId)
    await promoteCommitToMain(bareDir, commitId)
    void candidateRef
    const workDir = path.join(dataRoot, 'work')
    await extractCommitToDir(bareDir, commitId, workDir)
    const extracted = await fs.readFile(path.join(workDir, 'public', 'index.html'), 'utf8')
    expect(extracted).toBe(MULTILINE_HTML)
  })

  it.each([false, true])('首次 push 多行 HTML 时公开页字节一致（相对目录：%s）', async (relativeRoot) => {
    const dataRoot = await makeIsolatedDataRoot('publish-multiline')
    const { baseUrl, close } = await startRemoteServer({
      dataRoot: relativeRoot ? path.relative(process.cwd(), dataRoot) : dataRoot,
      serviceToken: token,
      publicBaseUrl: 'http://127.0.0.1:0',
    })
    try {
      const verifyScript = path.join(dataRoot, 'sc', 'verify-multiline.mjs')
      await fs.mkdir(path.dirname(verifyScript), { recursive: true })
      await fs.writeFile(
        verifyScript,
        `import fs from 'node:fs'\nconst expected = ${JSON.stringify(MULTILINE_HTML)}\nconst html = fs.readFileSync('public/index.html','utf8')\nif (html !== expected) { console.error('mismatch', JSON.stringify(html)); process.exit(4) }\n`,
        'utf8',
      )
      const createRes = await fetch(`${baseUrl}/api/remote/sites`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const { remoteSiteId } = (await createRes.json()) as { remoteSiteId: string }
      const manifest = JSON.stringify({
        version: 1,
        verifyCommand: [process.execPath, verifyScript],
      })
      const repoDir = path.join(dataRoot, 'r', 'multi')
      const { commitId } = await initSiteRepository(repoDir, {
        'olps.manifest.json': manifest,
        'source/site-settings.json': JSON.stringify({ defaultLocale: 'en', locales: ['en'] }),
        'public/index.html': MULTILINE_HTML,
      })
      const bundlePath = path.join(dataRoot, 'b', 'multi.bundle')
      await writeGitBundle(repoDir, bundlePath)
      const pushRes = await pushBundleHttp({
        baseUrl,
        token,
        remoteSiteId,
        bundlePath,
        commitId,
        expectedPublishedCommitId: null,
      })
      expect(pushRes.status).toBe(200)
      const pageRes = await fetch(`${baseUrl}/s/${remoteSiteId}/index.html`)
      expect(pageRes.status).toBe(200)
      expect(await pageRes.text()).toBe(MULTILINE_HTML)
    } finally {
      close()
    }
  })
})
