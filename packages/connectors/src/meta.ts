import { createHmac } from 'node:crypto'
import { FacebookAdsApi, EventRequest, ServerEvent, UserData } from 'facebook-nodejs-business-sdk'
import { requireProviderEnvironment, type Environment } from './config.js'
import type { OAuthTokens } from './oauth.js'
import type { ConnectorAccount } from './google.js'
import { providerRequest } from './request.js'

type MetaList<T> = { data: T[]; paging?: { next?: string; cursors?: { after?: string } } }

function numericId(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error('Meta标识无效')
  return value
}

function metaApi(tokens: OAuthTokens, environment: Environment): { api: FacebookAdsApi; params: { appsecret_proof: string } } {
  requireProviderEnvironment('meta', environment)
  if (!tokens.accessToken) throw new Error('Meta需要重新连接')
  return { api: new FacebookAdsApi(tokens.accessToken, undefined, false), params: { appsecret_proof: createHmac('sha256', environment.META_APP_SECRET!).update(tokens.accessToken).digest('hex') } }
}

async function rows<T>(api: FacebookAdsApi, edge: string[], params: Record<string, unknown>): Promise<T[]> {
  const output: T[] = []
  let after: string | undefined
  for (let page = 0; page < 100; page++) {
    const response = await providerRequest('meta', 'accounts-or-metrics', () => api.call<MetaList<T>>('GET', edge, { ...params, ...(after ? { after } : {}), limit: 100 }))
    if (!Array.isArray(response.data)) throw new Error('Meta未返回账户列表')
    output.push(...response.data)
    if (!response.paging?.next) return output
    after = response.paging.cursors?.after
    if (!after) throw new Error('Meta分页缺少游标')
  }
  throw new Error('Meta账户列表超过分页上限')
}

export async function listMetaAccounts(tokens: OAuthTokens, environment: Environment = process.env): Promise<ConnectorAccount[]> {
  const { api, params } = metaApi(tokens, environment)
  const accounts = await rows<{ id: string; name: string }>(api, ['me', 'adaccounts'], { ...params, fields: 'id,name' })
  const pixels: ConnectorAccount[] = []
  for (const account of accounts) {
    const accountPixels = await rows<{ id: string; name: string }>(api, [account.id, 'adspixels'], { ...params, fields: 'id,name' })
    pixels.push(...accountPixels.map(pixel => ({ id: pixel.id, name: `${pixel.name} (${account.name})`, metadata: { adAccountId: account.id } })))
  }
  return pixels
}

export type MetaConversion = { pixelId: string; eventId: string; dateTime: string; sourceUrl: string; email?: string; phone?: string; clientIp?: string; clientUserAgent?: string; fbc?: string; fbp?: string; consent: boolean; testEventCode?: string }

export async function sendMetaConversion(tokens: OAuthTokens, input: MetaConversion, environment: Environment = process.env): Promise<Record<string, unknown>> {
  requireProviderEnvironment('meta', environment)
  if (!input.consent) throw new Error('未获得广告同意，禁止发送转化')
  const eventTime = Math.floor(new Date(input.dateTime).getTime() / 1000)
  if (!Number.isSafeInteger(eventTime)) throw new Error('转化时间无效')
  const user = new UserData()
  if (input.email) user.setEmails([input.email])
  if (input.phone) user.setPhones([input.phone])
  if (input.clientIp) user.setClientIpAddress(input.clientIp)
  if (input.clientUserAgent) user.setClientUserAgent(input.clientUserAgent)
  if (input.fbc) user.setFbc(input.fbc)
  if (input.fbp) user.setFbp(input.fbp)
  const event = new ServerEvent().setEventName('Lead').setEventTime(eventTime).setEventId(input.eventId).setEventSourceUrl(input.sourceUrl).setActionSource('website').setUserData(user)
  const request = new EventRequest(tokens.accessToken, numericId(input.pixelId)).setEvents([event]).setAppSecret(environment.META_APP_SECRET!)
  if (input.testEventCode) request.setTestEventCode(input.testEventCode)
  const response = await providerRequest('meta', 'conversion', () => request.execute())
  if (response.events_received !== 1 || !response.fbtrace_id) throw new Error('Meta未确认转化事件')
  return { eventsReceived: response.events_received, traceId: response.fbtrace_id, messages: response.messages }
}

export async function readMetaDailyMetrics(tokens: OAuthTokens, adAccountId: string, date: string, environment: Environment = process.env): Promise<Record<string, unknown>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('指标日期无效')
  const account = adAccountId.replace(/^act_/, '')
  const { api, params } = metaApi(tokens, environment)
  const metrics = await rows<Record<string, unknown>>(api, [`act_${numericId(account)}`, 'insights'], { ...params, fields: 'account_id,account_currency,date_start,date_stop,impressions,clicks,spend,actions', level: 'account', time_range: { since: date, until: date } })
  return { rows: metrics }
}
