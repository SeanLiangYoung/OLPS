import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, expect, it } from 'vitest'
import { exchangeProviderCode, requireEnvironmentValue, requireProviderEnvironment, listGoogleAccounts, listMetaAccounts, setupGa4, setupGoogleAds, setupSearchConsole, sendGoogleConversion, sendMetaConversion, readGoogleDailyMetrics, readMetaDailyMetrics, type OAuthTokens } from './index.js'

const evidence: Record<string, unknown> = {}
let googleTokens: OAuthTokens | undefined
let metaTokens: OAuthTokens | undefined

afterAll(async () => {
  const directory = path.resolve('../../.intermediate/connector-live-validation')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'results.json'), `${JSON.stringify({ checkedAt: new Date().toISOString(), evidence }, null, 2)}\n`)
})

it('Google真实授权码交换与账户列表', async () => {
  requireProviderEnvironment('google')
  googleTokens = await exchangeProviderCode('google', requireEnvironmentValue('GOOGLE_LIVE_AUTHORIZATION_CODE'), requireEnvironmentValue('GOOGLE_LIVE_PKCE_VERIFIER'))
  const accounts = await Promise.all(['ga4', 'googleAds', 'searchConsole'].map(connector => listGoogleAccounts(connector as 'ga4', googleTokens!)))
  evidence.googleAccounts = accounts
  expect(accounts.every(list => list.length > 0)).toBe(true)
})

it('Meta真实授权码交换、账户列表和测试Lead事件', async () => {
  requireProviderEnvironment('meta')
  metaTokens = await exchangeProviderCode('meta', requireEnvironmentValue('META_LIVE_AUTHORIZATION_CODE'), null)
  const accounts = await listMetaAccounts(metaTokens)
  evidence.metaAccounts = accounts
  const pixelId = requireEnvironmentValue('META_LIVE_PIXEL_ID')
  expect(accounts.some(account => account.id === pixelId)).toBe(true)
  evidence.metaTestEvent = await sendMetaConversion(metaTokens, { pixelId, eventId: randomUUID(), dateTime: new Date().toISOString(), sourceUrl: requireEnvironmentValue('LIVE_SITE_URL'), email: requireEnvironmentValue('LIVE_CONTACT_EMAIL'), consent: true, testEventCode: requireEnvironmentValue('META_TEST_EVENT_CODE') })
})

it('Google转化创建、关键事件、验证META与离线转化真实返回结果', async () => {
  if (!googleTokens) throw new Error('Google真实OAuth验收尚未完成')
  evidence.ga4Setup = await setupGa4(googleTokens, requireEnvironmentValue('GA4_LIVE_PROPERTY_ID'))
  const ads = await setupGoogleAds(googleTokens, requireEnvironmentValue('GOOGLE_ADS_LIVE_CUSTOMER_ID'), requireEnvironmentValue('LIVE_SITE_ID'))
  evidence.adsSetup = ads
  evidence.searchSetup = await setupSearchConsole(googleTokens, requireEnvironmentValue('LIVE_SITE_URL'))
  evidence.offlineConversion = await sendGoogleConversion(googleTokens, { accountId: ads.accountId, action: ads.qualifiedAction, event: 'qualified', eventId: randomUUID(), dateTime: new Date().toISOString().slice(0, 19).replace('T', ' ') + '+00:00', gclid: requireEnvironmentValue('GOOGLE_LIVE_GCLID'), email: requireEnvironmentValue('LIVE_CONTACT_EMAIL'), consent: true })
})

it('四个真实平台每日数据读取', async () => {
  if (!googleTokens || !metaTokens) throw new Error('Google与Meta真实OAuth验收尚未完成')
  const date = requireEnvironmentValue('LIVE_METRICS_DATE')
  evidence.ga4Metrics = await readGoogleDailyMetrics('ga4', googleTokens, requireEnvironmentValue('GA4_LIVE_PROPERTY_ID'), date)
  evidence.adsMetrics = await readGoogleDailyMetrics('googleAds', googleTokens, requireEnvironmentValue('GOOGLE_ADS_LIVE_CUSTOMER_ID'), date)
  evidence.searchMetrics = await readGoogleDailyMetrics('searchConsole', googleTokens, requireEnvironmentValue('LIVE_SITE_URL'), date)
  evidence.metaMetrics = await readMetaDailyMetrics(metaTokens, requireEnvironmentValue('META_LIVE_AD_ACCOUNT_ID'), date)
})
