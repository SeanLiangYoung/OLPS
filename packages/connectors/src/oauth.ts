import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library'
import { FacebookAdsApi } from 'facebook-nodejs-business-sdk'
import { oauthRedirect, requireProviderEnvironment, type Environment, type Provider } from './config.js'
import { providerRequest } from './request.js'

export type OAuthTokens = { accessToken: string; refreshToken?: string; expiresAt?: number; scope?: string }
export const googleScopes = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/analytics.edit',
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/siteverification',
] as const

export function googleAuth(tokens?: OAuthTokens, environment: Environment = process.env): OAuth2Client {
  requireProviderEnvironment('google', environment)
  const auth = new OAuth2Client({ clientId: environment.GOOGLE_OAUTH_CLIENT_ID!, clientSecret: environment.GOOGLE_OAUTH_CLIENT_SECRET!, redirectUri: oauthRedirect('google', environment) })
  if (tokens) auth.setCredentials({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken, expiry_date: tokens.expiresAt, scope: tokens.scope })
  return auth
}

export async function providerAuthorizationUrl(provider: Provider, state: string, environment: Environment = process.env): Promise<{ url: string; verifier: string | null }> {
  requireProviderEnvironment(provider, environment)
  if (provider === 'google') {
    const auth = googleAuth(undefined, environment)
    const verifier = await auth.generateCodeVerifierAsync()
    return { verifier: verifier.codeVerifier, url: auth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', state, scope: [...googleScopes], include_granted_scopes: true, code_challenge: verifier.codeChallenge, code_challenge_method: CodeChallengeMethod.S256 }) }
  }
  const url = new URL(`https://www.facebook.com/${FacebookAdsApi.VERSION}/dialog/oauth`)
  url.searchParams.set('client_id', environment.META_APP_ID!)
  url.searchParams.set('redirect_uri', oauthRedirect('meta', environment))
  url.searchParams.set('state', state)
  url.searchParams.set('scope', 'ads_read,ads_management,business_management')
  url.searchParams.set('response_type', 'code')
  return { verifier: null, url: url.href }
}

export async function exchangeProviderCode(provider: Provider, code: string, verifier: string | null, environment: Environment = process.env): Promise<OAuthTokens> {
  requireProviderEnvironment(provider, environment)
  if (!code) throw new Error('OAuth授权码缺失')
  if (provider === 'google') {
    if (!verifier) throw new Error('Google OAuth PKCE校验信息缺失')
    const { tokens } = await providerRequest('google', 'oauth-code', () => googleAuth(undefined, environment).getToken({ code, codeVerifier: verifier }))
    if (!tokens.access_token) throw new Error('Google OAuth未返回访问令牌')
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? undefined, expiresAt: tokens.expiry_date ?? undefined, scope: tokens.scope }
  }
  const api = new FacebookAdsApi('', undefined, false)
  const exchanged = await providerRequest('meta', 'oauth-code', () => api.call<{ access_token?: string; expires_in?: number }>('GET', ['oauth', 'access_token'], { client_id: environment.META_APP_ID!, client_secret: environment.META_APP_SECRET!, redirect_uri: oauthRedirect('meta', environment), code }))
  if (!exchanged.access_token) throw new Error('Meta OAuth未返回访问令牌')
  const longLived = await providerRequest('meta', 'oauth-long-lived', () => api.call<{ access_token?: string; expires_in?: number }>('GET', ['oauth', 'access_token'], { grant_type: 'fb_exchange_token', client_id: environment.META_APP_ID!, client_secret: environment.META_APP_SECRET!, fb_exchange_token: exchanged.access_token }))
  if (!longLived.access_token) throw new Error('Meta OAuth未返回长期访问令牌')
  return { accessToken: longLived.access_token, ...(longLived.expires_in ? { expiresAt: Date.now() + longLived.expires_in * 1000 } : {}) }
}

export async function refreshGoogleTokens(tokens: OAuthTokens, environment: Environment = process.env): Promise<OAuthTokens> {
  const auth = googleAuth(tokens, environment)
  const access = await providerRequest('google', 'oauth-refresh', () => auth.getAccessToken())
  if (!access.token) throw new Error('Google凭据需要重新连接')
  return { ...tokens, accessToken: access.token, refreshToken: auth.credentials.refresh_token ?? tokens.refreshToken, expiresAt: auth.credentials.expiry_date ?? tokens.expiresAt }
}
