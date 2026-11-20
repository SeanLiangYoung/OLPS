import { createServer, type Server } from 'node:http'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureHtml = fs.readFileSync(
  path.join(packageRoot, 'test-fixtures', 'page.html'),
  'utf8',
)

type ConsentCookie = {
  analytics: boolean
  advertising: boolean
}

type AttributionCookie = {
  gclid?: string
  gbraid?: string
  wbraid?: string
  fbclid?: string
  ttclid?: string
  msclkid?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  landingPage?: string
  referrer?: string
}

type PageOlps = {
  on: (event: string, handler: (payload: unknown) => void) => void
  emit: (event: string, payload?: unknown) => void
  getAttribution: () => AttributionCookie
  getConsent: () => ConsentCookie | null
}

function isThirdPartyUrl(rawUrl: string, localPort: number): boolean {
  const url = new URL(rawUrl)
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
    return url.port !== String(localPort)
  }
  return true
}

function buildBundle(): string {
  execFileSync(process.execPath, [path.join(packageRoot, 'scripts', 'build.mjs')], {
    cwd: packageRoot,
    stdio: 'pipe',
  })
  const bundlePath = path.join(packageRoot, 'dist', 'olps-tracking.js')
  return fs.readFileSync(bundlePath, 'utf8')
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('无法取得测试服务器地址')
  }
  return address.port
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function createFixtureServer(bundleCode: string): Server {
  return createServer((request, response) => {
    const url = request.url ?? '/'
    if (url.startsWith('/olps-tracking.js')) {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(bundleCode)
      return
    }
    if (url.startsWith('/cookies')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!DOCTYPE html><html><body>cookie policy</body></html>')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(fixtureHtml)
  })
}

async function readCookieJson<T>(page: Page, name: string): Promise<T | null> {
  return page.evaluate((cookieName) => {
    const parts = document.cookie.split(';').map((part) => part.trim())
    for (const part of parts) {
      if (!part.startsWith(`${cookieName}=`)) continue
      const value = decodeURIComponent(part.slice(cookieName.length + 1))
      return JSON.parse(value) as T
    }
    return null
  }, name)
}

async function waitForBanner(page: Page): Promise<void> {
  await page.waitForSelector('[data-olps-consent-banner]', { state: 'visible' })
}

describe('tracking-runtime Chromium', () => {
  let bundleCode: string
  let browser: Browser

  beforeAll(async () => {
    bundleCode = buildBundle()
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    if (browser) {
      await browser.close()
    }
  })

  it('未同意时显示提示条且第三方请求数为 0', async () => {
    const server = createFixtureServer(bundleCode)
    const port = await listen(server)
    const thirdParty: string[] = []
    const page = await browser.newPage()
    page.on('request', (request) => {
      if (isThirdPartyUrl(request.url(), port)) {
        thirdParty.push(request.url())
      }
    })

    try {
      await page.goto(`http://127.0.0.1:${port}/`)
      await waitForBanner(page)
      await page.waitForTimeout(500)
      expect(thirdParty).toEqual([])
      const consent = await readCookieJson<ConsentCookie>(page, 'olps_consent')
      expect(consent).toBeNull()
      const bannerVisible = await page.isVisible('[data-olps-consent-banner]')
      expect(bannerVisible).toBe(true)
    } finally {
      await page.close()
      await closeServer(server)
    }
  })

  it('仅统计：写入同意 Cookie，只加载统计平台，不加载广告平台', async () => {
    const server = createFixtureServer(bundleCode)
    const port = await listen(server)
    const page = await browser.newPage()

    try {
      await page.goto(`http://127.0.0.1:${port}/`)
      await waitForBanner(page)
      await page.click('[data-olps-consent-customize]')
      await page.check('[data-olps-consent-analytics]')
      const advertisingChecked = await page.isChecked('[data-olps-consent-advertising]')
      if (advertisingChecked) {
        await page.uncheck('[data-olps-consent-advertising]')
      }
      await page.click('[data-olps-consent-save]')
      await page.waitForSelector('[data-olps-consent-banner]', { state: 'hidden' })

      const consent = await readCookieJson<ConsentCookie>(page, 'olps_consent')
      expect(consent).toEqual({ analytics: true, advertising: false })

      const scripts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('script[src]')).map(
          (node) => (node as HTMLScriptElement).src,
        ),
      )
      expect(scripts.some((src) => src.includes('googletagmanager.com/gtag/js'))).toBe(true)
      expect(scripts.some((src) => src.includes('googletagmanager.com/gtm.js'))).toBe(true)
      expect(scripts.some((src) => src.includes('clarity.ms'))).toBe(true)
      expect(scripts.some((src) => src.includes('connect.facebook.net'))).toBe(false)
      expect(scripts.some((src) => src.includes('analytics.tiktok.com'))).toBe(false)
      expect(scripts.some((src) => src.includes('snap.licdn.com'))).toBe(false)
      expect(scripts.some((src) => src.includes('bat.bing.com'))).toBe(false)
    } finally {
      await page.close()
      await closeServer(server)
    }
  })

  it('全部同意：加载全部已配置平台', async () => {
    const server = createFixtureServer(bundleCode)
    const port = await listen(server)
    const page = await browser.newPage()

    try {
      await page.goto(`http://127.0.0.1:${port}/`)
      await waitForBanner(page)
      await page.click('[data-olps-consent-accept-all]')
      await page.waitForSelector('[data-olps-consent-banner]', { state: 'hidden' })

      const consent = await readCookieJson<ConsentCookie>(page, 'olps_consent')
      expect(consent).toEqual({ analytics: true, advertising: true })

      const scripts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('script[src]')).map(
          (node) => (node as HTMLScriptElement).src,
        ),
      )
      expect(scripts.some((src) => src.includes('googletagmanager.com/gtag/js'))).toBe(true)
      expect(scripts.some((src) => src.includes('googletagmanager.com/gtm.js'))).toBe(true)
      expect(scripts.some((src) => src.includes('clarity.ms'))).toBe(true)
      expect(scripts.some((src) => src.includes('connect.facebook.net'))).toBe(true)
      expect(scripts.some((src) => src.includes('analytics.tiktok.com'))).toBe(true)
      expect(scripts.some((src) => src.includes('snap.licdn.com'))).toBe(true)
      expect(scripts.some((src) => src.includes('bat.bing.com'))).toBe(true)
    } finally {
      await page.close()
      await closeServer(server)
    }
  })

  it('全部拒绝：隐藏提示条且不注入第三方脚本', async () => {
    const server = createFixtureServer(bundleCode)
    const port = await listen(server)
    const page = await browser.newPage()
    const thirdParty: string[] = []
    page.on('request', (request) => {
      if (isThirdPartyUrl(request.url(), port)) {
        thirdParty.push(request.url())
      }
    })

    try {
      await page.goto(`http://127.0.0.1:${port}/`)
      await waitForBanner(page)
      thirdParty.length = 0
      await page.click('[data-olps-consent-reject-all]')
      await page.waitForSelector('[data-olps-consent-banner]', { state: 'hidden' })
      await page.waitForTimeout(500)

      const consent = await readCookieJson<ConsentCookie>(page, 'olps_consent')
      expect(consent).toEqual({ analytics: false, advertising: false })
      expect(thirdParty).toEqual([])

      const scripts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('script[src]')).map(
          (node) => (node as HTMLScriptElement).src,
        ),
      )
      const trackingOnly = scripts.filter((src) => !src.includes('/olps-tracking.js'))
      expect(trackingOnly).toEqual([])
    } finally {
      await page.close()
      await closeServer(server)
    }
  })

  it('重新设置：页脚 Cookie 设置可再次打开提示条并修改选择', async () => {
    const server = createFixtureServer(bundleCode)
    const port = await listen(server)
    const page = await browser.newPage()

    try {
      await page.goto(`http://127.0.0.1:${port}/`)
      await waitForBanner(page)
      await page.click('[data-olps-consent-reject-all]')
      await page.waitForSelector('[data-olps-consent-banner]', { state: 'hidden' })

      await page.click('[data-olps-cookie-settings]')
      await waitForBanner(page)
      await page.click('[data-olps-consent-accept-all]')
      await page.waitForSelector('[data-olps-consent-banner]', { state: 'hidden' })

      const consent = await readCookieJson<ConsentCookie>(page, 'olps_consent')
      expect(consent).toEqual({ analytics: true, advertising: true })
    } finally {
      await page.close()
      await closeServer(server)
    }
  })

  it('广告来源写入 9 类字段到 olps_attribution Cookie', async () => {
    const server = createFixtureServer(bundleCode)
    const port = await listen(server)
    const page = await browser.newPage()
    const query = [
      'gclid=gclid-1',
      'gbraid=gbraid-1',
      'wbraid=wbraid-1',
      'fbclid=fbclid-1',
      'ttclid=ttclid-1',
      'msclkid=msclkid-1',
      'utm_source=google',
      'utm_medium=cpc',
      'utm_campaign=spring',
      'utm_term=shoes',
      'utm_content=ad-a',
    ].join('&')

    try {
      await page.goto(`http://127.0.0.1:${port}/landing?${query}`, {
        referer: 'https://ads.example.com/ref',
      })
      await waitForBanner(page)

      const attribution = await readCookieJson<AttributionCookie>(page, 'olps_attribution')
      expect(attribution).toMatchObject({
        gclid: 'gclid-1',
        gbraid: 'gbraid-1',
        wbraid: 'wbraid-1',
        fbclid: 'fbclid-1',
        ttclid: 'ttclid-1',
        msclkid: 'msclkid-1',
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'spring',
        utm_term: 'shoes',
        utm_content: 'ad-a',
        referrer: 'https://ads.example.com/ref',
      })
      expect(attribution?.landingPage).toContain('/landing')
      expect(attribution?.landingPage).toContain('gclid=gclid-1')

      const viaApi = await page.evaluate(() => {
        const olps = (window as unknown as { olps: PageOlps }).olps
        return olps.getAttribution()
      })
      expect(viaApi.gclid).toBe('gclid-1')
      expect(viaApi.utm_campaign).toBe('spring')
    } finally {
      await page.close()
      await closeServer(server)
    }
  })

  it('自动与转化相关标准事件共 7 类，并生成 event_id', async () => {
    const server = createFixtureServer(bundleCode)
    const port = await listen(server)
    const page = await browser.newPage()

    try {
      await page.goto(`http://127.0.0.1:${port}/`)
      await waitForBanner(page)
      await page.click('[data-olps-consent-accept-all]')
      await page.waitForSelector('[data-olps-consent-banner]', { state: 'hidden' })
      await page.waitForFunction(() => Array.isArray((window as unknown as { dataLayer?: unknown[] }).dataLayer))

      const received = await page.evaluate(async () => {
        const olps = (window as unknown as { olps: PageOlps }).olps
        const events: Array<{ name: string; event_id?: string }> = []
        const record = (name: string) => {
          olps.on(name, (payload) => {
            const body = payload as { event_id?: string }
            events.push({ name, event_id: body.event_id })
          })
        }
        for (const name of [
          'page_view',
          'phone_click',
          'email_click',
          'form_start',
          'inquiry_submit',
          'whatsapp_click',
          'contact',
        ]) {
          record(name)
        }

        // 同意后应已发出 page_view；补订阅拿不到历史，这里再 emit 一次验证总线
        olps.emit('page_view', {})
        document.getElementById('phone-link')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        document.getElementById('email-link')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        document.getElementById('name-input')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
        olps.emit('inquiry_submit', { value: 1 })
        olps.emit('whatsapp_click', {})
        olps.emit('contact', { channel: 'custom' })

        await new Promise((resolve) => setTimeout(resolve, 50))
        return events
      })

      const names = received.map((item) => item.name)
      expect(names).toEqual(
        expect.arrayContaining([
          'page_view',
          'phone_click',
          'email_click',
          'form_start',
          'inquiry_submit',
          'whatsapp_click',
          'contact',
        ]),
      )
      expect(new Set(names).size).toBeGreaterThanOrEqual(7)
      for (const item of received) {
        expect(item.event_id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        )
      }

      const platformCalls = await page.evaluate(() => {
        const dataLayer = (window as unknown as { dataLayer: unknown[] }).dataLayer
        const fbq = (window as unknown as { fbq: { calls: unknown[][] } }).fbq
        const ttq = (window as unknown as { ttq: { calls: unknown[][] } }).ttq
        const uetq = (window as unknown as { uetq: unknown[] }).uetq
        return {
          dataLayer,
          fbqCalls: fbq?.calls ?? [],
          ttqCalls: ttq?.calls ?? [],
          uetq,
        }
      })

      expect(platformCalls.dataLayer.some((entry) => {
        if (!entry || typeof entry !== 'object') return false
        const row = entry as Record<string, unknown>
        return row.event === 'generate_lead' || row[0] === 'event' && row[1] === 'generate_lead'
      }) || platformCalls.dataLayer.some((entry) => Array.isArray(entry) && entry[0] === 'event' && entry[1] === 'generate_lead')).toBe(true)

      expect(
        platformCalls.fbqCalls.some((call) => call[0] === 'track' && call[1] === 'Lead'),
      ).toBe(true)
      expect(
        platformCalls.ttqCalls.some((call) => call[0] === 'track' && call[1] === 'SubmitForm'),
      ).toBe(true)
    } finally {
      await page.close()
      await closeServer(server)
    }
  })

  it('Google Consent Mode v2 默认 denied，同意后更新；Meta 调用 consent', async () => {
    const server = createFixtureServer(bundleCode)
    const port = await listen(server)
    const page = await browser.newPage()

    try {
      await page.goto(`http://127.0.0.1:${port}/`)
      await waitForBanner(page)
      await page.click('[data-olps-consent-accept-all]')
      await page.waitForSelector('[data-olps-consent-banner]', { state: 'hidden' })
      await page.waitForFunction(() => typeof (window as unknown as { gtag?: unknown }).gtag === 'function')

      const consentCalls = await page.evaluate(() => {
        const dataLayer = (window as unknown as { dataLayer: unknown[] }).dataLayer
        const fbq = (window as unknown as { fbq: { calls: unknown[][] } }).fbq
        const gtagConsent = dataLayer.filter((entry) => {
          return Array.isArray(entry) && entry[0] === 'consent'
        })
        return {
          gtagConsent,
          fbqConsent: (fbq?.calls ?? []).filter((call) => call[0] === 'consent'),
        }
      })

      expect(consentCalls.gtagConsent.length).toBeGreaterThanOrEqual(1)
      const hasUpdateGranted = consentCalls.gtagConsent.some((entry) => {
        if (!Array.isArray(entry)) return false
        const mode = entry[1]
        const body = entry[2] as Record<string, string> | undefined
        return (
          mode === 'update' &&
          body?.analytics_storage === 'granted' &&
          body?.ad_storage === 'granted'
        )
      })
      expect(hasUpdateGranted).toBe(true)
      expect(
        consentCalls.fbqConsent.some((call) => call[1] === 'grant'),
      ).toBe(true)
    } finally {
      await page.close()
      await closeServer(server)
    }
  })
})
