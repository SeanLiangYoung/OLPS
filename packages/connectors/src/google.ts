import { GoogleAdsApi, enums, services, type Customer } from 'google-ads-api'
import { v1beta as analyticsAdmin } from '@google-analytics/admin'
import { BetaAnalyticsDataClient } from '@google-analytics/data'
import { google } from 'googleapis'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { googleAuth, type OAuthTokens } from './oauth.js'
import { requireEnvironmentValue, requireProviderEnvironment, type Environment } from './config.js'
import { googleConversionTag } from './tag-snippet.js'
import { hashGoogleEmail, hashPhone } from './identifiers.js'
import { providerRequest } from './request.js'

export type GoogleConnector = 'ga4' | 'googleAds' | 'searchConsole'
export type ConnectorAccount = { id: string; name: string; metadata?: Record<string, unknown> }

export async function readGa4RealtimeLeadCount(tokens: OAuthTokens, propertyId: string, environment: Environment = process.env): Promise<{count:number;response:Record<string,unknown>}> {
  requireProviderEnvironment('google',environment)
  return providerRequest('google','ga4-realtime-leads',async()=>{
    const client=new BetaAnalyticsDataClient({authClient:googleAuth(tokens,environment)})
    try {
      const [response]=await client.runRealtimeReport({property:`properties/${numericId(propertyId.replace(/^properties\//,''))}`,dimensions:[{name:'eventName'}],metrics:[{name:'eventCount'}],dimensionFilter:{filter:{fieldName:'eventName',stringFilter:{matchType:'EXACT',value:'generate_lead'}}}})
      const count=(response.rows??[]).reduce((total,row)=>total+Number(row.metricValues?.[0]?.value??0),0)
      if(!Number.isSafeInteger(count)||count<0)throw new Error('GA4实时指标数量无效')
      return {count,response:response as Record<string,unknown>}
    } finally {await client.close()}
  })
}

function numericId(value: string): string {
  const id = value.replaceAll('-', '')
  if (!/^\d+$/.test(id)) throw new Error('Google账户标识无效')
  return id
}

export function googleAdsClient(environment: Environment = process.env): GoogleAdsApi {
  requireProviderEnvironment('google', environment)
  return new GoogleAdsApi({ client_id: requireEnvironmentValue('GOOGLE_OAUTH_CLIENT_ID', environment), client_secret: requireEnvironmentValue('GOOGLE_OAUTH_CLIENT_SECRET', environment), developer_token: requireEnvironmentValue('GOOGLE_ADS_DEVELOPER_TOKEN', environment) })
}

function adsCustomer(tokens: OAuthTokens, accountId: string, environment: Environment): Customer {
  if (!tokens.refreshToken) throw new Error('Google Ads需要重新连接以取得离线访问授权')
  return googleAdsClient(environment).Customer({ customer_id: numericId(accountId), refresh_token: tokens.refreshToken, ...(environment.GOOGLE_ADS_LOGIN_CUSTOMER_ID ? { login_customer_id: numericId(environment.GOOGLE_ADS_LOGIN_CUSTOMER_ID) } : {}) })
}

async function googleAccounts(connector: GoogleConnector, tokens: OAuthTokens, environment: Environment): Promise<ConnectorAccount[]> {
  if (connector === 'googleAds') {
    if (!tokens.refreshToken) throw new Error('Google Ads需要重新连接')
    const response = await googleAdsClient(environment).listAccessibleCustomers(tokens.refreshToken)
    return response.resource_names.map(resource => ({ id: resource.replace(/^customers\//, ''), name: resource }))
  }
  const auth = googleAuth(tokens, environment)
  if (connector === 'ga4') {
    const client = new analyticsAdmin.AnalyticsAdminServiceClient({ authClient: auth })
    try {
      const [accounts] = await client.listAccountSummaries({})
      return accounts.flatMap(account => (account.propertySummaries ?? []).map(property => ({ id: String(property.property), name: String(property.displayName ?? property.property) })))
    } finally { await client.close() }
  }
  const response = await google.searchconsole({ version: 'v1', auth }).sites.list()
  return (response.data.siteEntry ?? []).filter(entry => entry.permissionLevel !== 'siteUnverifiedUser').map(entry => ({ id: String(entry.siteUrl), name: String(entry.siteUrl), metadata: { permissionLevel: entry.permissionLevel } }))
}

async function configureGa4(tokens: OAuthTokens, propertyId: string, environment: Environment): Promise<{ accountId: string; measurementId: string; keyEvent: string }> {
  const parent = `properties/${numericId(propertyId.replace(/^properties\//, ''))}`
  const client = new analyticsAdmin.AnalyticsAdminServiceClient({ authClient: googleAuth(tokens, environment) })
  try {
    const [streams] = await client.listDataStreams({ parent })
    const measurementId = streams.find(stream => stream.webStreamData?.measurementId)?.webStreamData?.measurementId
    if (!measurementId) throw new Error('GA4媒体资源缺少网站数据流')
    const [events] = await client.listKeyEvents({ parent })
    let event = events.find(item => item.eventName === 'generate_lead')
    if (!event) [event] = await client.createKeyEvent({ parent, keyEvent: { eventName: 'generate_lead', countingMethod: 'ONCE_PER_EVENT' } })
    if (!event.name) throw new Error('GA4未返回关键事件标识')
    return { accountId: parent, measurementId, keyEvent: event.name }
  } finally { await client.close() }
}

async function configureAds(tokens: OAuthTokens, accountId: string, siteId: string, environment: Environment): Promise<{ accountId: string; submitAction: string; qualifiedAction: string; conversionId: string; conversionLabel: string }> {
  if (!/^[a-zA-Z0-9-]+$/.test(siteId)) throw new Error('网站标识无效')
  const customer = adsCustomer(tokens, accountId, environment)
  const actions: string[] = []
  for (const kind of ['Submit', 'Qualified']) {
    const name = `OLPS ${kind} Inquiry ${siteId}`
    const existing = await customer.query(`SELECT conversion_action.resource_name FROM conversion_action WHERE conversion_action.name = '${name}' AND conversion_action.status != 'REMOVED' LIMIT 1`)
    let resource = existing[0]?.conversion_action?.resource_name
    if (!resource) {
      const created = await customer.conversionActions.create([{ name, category: enums.ConversionActionCategory.SUBMIT_LEAD_FORM, status: enums.ConversionActionStatus.ENABLED, type: kind === 'Submit' ? enums.ConversionActionType.WEBPAGE : enums.ConversionActionType.UPLOAD_CLICKS }])
      resource = created.results[0]?.resource_name
    }
    if (!resource) throw new Error('Google Ads未返回转化操作标识')
    actions.push(resource)
  }
  const rows = await customer.query(`SELECT conversion_action.resource_name, conversion_action.tag_snippets FROM conversion_action WHERE conversion_action.resource_name = '${actions[0]}'`)
  const snippets = rows[0]?.conversion_action?.tag_snippets ?? []
  const eventSnippet = snippets.map(snippet => snippet.event_snippet ?? '').join('\n')
  return { accountId: numericId(accountId), submitAction: actions[0], qualifiedAction: actions[1], ...googleConversionTag(eventSnippet) }
}

async function configureSearch(tokens: OAuthTokens, siteUrl: string, environment: Environment): Promise<{ accountId: string; verificationMeta: string }> {
  const url = new URL(siteUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Search Console网站地址无效')
  const auth = googleAuth(tokens, environment)
  const response = await google.siteVerification({ version: 'v1', auth }).webResource.getToken({ requestBody: { site: { type: 'SITE', identifier: siteUrl }, verificationMethod: 'META' } })
  if (!response.data.token) throw new Error('Site Verification未返回验证内容')
  let verificationMeta: string | undefined
  const walk = (node: DefaultTreeAdapterMap['node']): void => {
    if ('tagName' in node && node.tagName === 'meta' && node.attrs.find(attr => attr.name === 'name')?.value === 'google-site-verification') verificationMeta = node.attrs.find(attr => attr.name === 'content')?.value
    if ('childNodes' in node) for (const child of node.childNodes) walk(child)
  }
  walk(parseFragment(response.data.token))
  if (!verificationMeta) throw new Error('Site Verification返回的META标签无效')
  return { accountId: siteUrl, verificationMeta }
}

async function verifySearch(tokens: OAuthTokens, siteUrl: string, environment: Environment, publicUrl: string): Promise<{ verificationId: string; status: number }> {
  const auth = googleAuth(tokens, environment)
  const verified = await google.siteVerification({ version: 'v1', auth }).webResource.insert({ verificationMethod: 'META', requestBody: { site: { type: 'SITE', identifier: siteUrl } } })
  if (!verified.data.id) throw new Error('Site Verification未返回验证标识')
  const search = google.searchconsole({ version: 'v1', auth })
  await search.sites.add({ siteUrl })
  const submitted = await search.sitemaps.submit({ siteUrl, feedpath: new URL('sitemap.xml', `${publicUrl.replace(/\/$/, '')}/`).href })
  return { verificationId: verified.data.id, status: submitted.status }
}

export type GoogleConversion = { eventId: string; dateTime: string; email?: string; phone?: string; gclid?: string; gbraid?: string; wbraid?: string; consent: boolean; event: 'submit' | 'qualified'; action: string; accountId: string }

async function googleConversion(tokens: OAuthTokens, input: GoogleConversion, environment: Environment): Promise<Record<string, unknown>> {
  if (!input.consent) throw new Error('未获得广告同意，禁止发送转化')
  const customer = adsCustomer(tokens, input.accountId, environment)
  if (!/^customers\/\d+\/conversionActions\/\d+$/.test(input.action)) throw new Error('Google Ads转化操作标识无效')
  const userIdentifiers = [
    ...(input.email ? [{ hashed_email: hashGoogleEmail(input.email) }] : []),
    ...(input.phone ? [{ hashed_phone_number: hashPhone(input.phone) }] : []),
  ]
  if (input.event === 'submit') {
    if (!userIdentifiers.length) throw new Error('增强型转化缺少邮箱或电话号码')
    const response = await customer.conversionAdjustmentUploads.uploadConversionAdjustments(new services.UploadConversionAdjustmentsRequest({ customer_id: numericId(input.accountId), partial_failure: true, conversion_adjustments: [{ conversion_action: input.action, adjustment_type: enums.ConversionAdjustmentType.ENHANCEMENT, adjustment_date_time: input.dateTime, order_id: input.eventId, user_identifiers: userIdentifiers }] }))
    if (response.partial_failure_error?.code) throw new Error(`Google Ads转化发送失败：${response.partial_failure_error.message}`)
    return response.toJSON()
  }
  if (!input.gclid && !input.gbraid && !input.wbraid) throw new Error('离线转化缺少广告点击标识')
  const response = await customer.conversionUploads.uploadClickConversions(new services.UploadClickConversionsRequest({ customer_id: numericId(input.accountId), partial_failure: true, conversions: [{ conversion_action: input.action, conversion_date_time: input.dateTime, order_id: input.eventId, gclid: input.gclid, gbraid: input.gbraid, wbraid: input.wbraid, user_identifiers: userIdentifiers, consent: { ad_user_data: enums.ConsentStatus.GRANTED, ad_personalization: enums.ConsentStatus.GRANTED } }] }))
  if (response.partial_failure_error?.code) throw new Error(`Google Ads转化发送失败：${response.partial_failure_error.message}`)
  return response.toJSON()
}

async function googleDailyMetrics(connector: GoogleConnector, tokens: OAuthTokens, accountId: string, date: string, environment: Environment): Promise<Record<string, unknown>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('指标日期无效')
  if (connector === 'googleAds') return { rows: await adsCustomer(tokens, accountId, environment).query(`SELECT customer.id, customer.currency_code, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM customer WHERE segments.date = '${date}'`) }
  if (connector === 'ga4') {
    const client = new BetaAnalyticsDataClient({ authClient: googleAuth(tokens, environment) })
    const property = `properties/${numericId(accountId.replace(/^properties\//, ''))}`
    try {
      const [totals] = await client.runReport({ property, dateRanges: [{ startDate: date, endDate: date }], dimensions: [{ name: 'date' }], metrics: ['activeUsers', 'sessions', 'screenPageViews', 'keyEvents'].map(name => ({ name })) })
      const [sources] = await client.runReport({ property, dateRanges: [{ startDate: date, endDate: date }], dimensions: [{ name: 'sessionSourceMedium' }], metrics: [{ name: 'sessions' }] })
      return { totals, sources }
    } finally { await client.close() }
  }
  const response = await google.searchconsole({ version: 'v1', auth: googleAuth(tokens, environment) }).searchanalytics.query({ siteUrl: accountId, requestBody: { startDate: date, endDate: date, dimensions: ['date'] } })
  return response.data as Record<string, unknown>
}

export function listGoogleAccounts(connector: GoogleConnector, tokens: OAuthTokens, environment: Environment = process.env) { requireProviderEnvironment('google', environment); return providerRequest('google', 'accounts', () => googleAccounts(connector, tokens, environment)) }
export function setupGa4(tokens: OAuthTokens, propertyId: string, environment: Environment = process.env) { requireProviderEnvironment('google', environment); return providerRequest('google', 'ga4-setup', () => configureGa4(tokens, propertyId, environment)) }
export function setupGoogleAds(tokens: OAuthTokens, accountId: string, siteId: string, environment: Environment = process.env) { requireProviderEnvironment('google', environment); return providerRequest('google', 'ads-setup', () => configureAds(tokens, accountId, siteId, environment)) }
export function setupSearchConsole(tokens: OAuthTokens, siteUrl: string, environment: Environment = process.env) { requireProviderEnvironment('google', environment); return providerRequest('google', 'search-console-setup', () => configureSearch(tokens, siteUrl, environment)) }
export function verifySearchConsole(tokens: OAuthTokens, siteUrl: string, environment: Environment = process.env, publicUrl = siteUrl) { requireProviderEnvironment('google', environment); return providerRequest('google', 'search-console-verify', () => verifySearch(tokens, siteUrl, environment, publicUrl)) }
export function sendGoogleConversion(tokens: OAuthTokens, input: GoogleConversion, environment: Environment = process.env) { requireProviderEnvironment('google', environment); return providerRequest('google', 'conversion', () => googleConversion(tokens, input, environment)) }
export function readGoogleDailyMetrics(connector: GoogleConnector, tokens: OAuthTokens, accountId: string, date: string, environment: Environment = process.env) { requireProviderEnvironment('google', environment); return providerRequest('google', 'daily-metrics', () => googleDailyMetrics(connector, tokens, accountId, date, environment)) }
