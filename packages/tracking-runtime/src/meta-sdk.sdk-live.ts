import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

declare global {
  interface Window { __metaConsentProbe: () => void }
}

it('真实 Meta SDK 加载后直接处理同意变更，命令没有滞留在启动队列', async () => {
  const bundle = await build({
    stdin: { contents: "import { revokeMetaConsent } from './src/platforms/meta.ts'; window.__metaConsentProbe = revokeMetaConsent", resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'browser', format: 'iife',
  })
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><html lang="en"><head><title>Meta SDK consent</title></head><body></body></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    await page.evaluate(() => window.__metaConsentProbe())
    const sdkUrl = 'https://connect.facebook.net/en_US/fbevents.js'
    const received = page.waitForResponse(response => response.url() === sdkUrl)
    await page.addScriptTag({ url: sdkUrl })
    const sdk = await received
    expect(sdk.status()).toBe(200)
    expect(await page.evaluate(() => typeof (window.fbq as typeof window.fbq & { callMethod?: unknown }).callMethod)).toBe('function')
    for (const consent of ['grant', 'revoke', 'grant'] as const) {
      await page.evaluate(value => window.fbq('consent', value), consent)
      expect(await page.evaluate(() => window.fbq.queue.length), consent).toBe(0)
    }
    const directory = path.resolve('../../.intermediate/tracking-sdk-validation')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'meta.json'), JSON.stringify({
      checkedAt: new Date().toISOString(), sdkUrl, sdkSha256: createHash('sha256').update(await sdk.body()).digest('hex'),
      chromiumVersion: browser.version(), consentCommands: ['grant', 'revoke', 'grant'], remainingCommands: 0,
    }, null, 2) + '\n')
  } finally {
    await browser.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
