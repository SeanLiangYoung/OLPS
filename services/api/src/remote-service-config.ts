import { appConfig } from './config.js'

export function requireRemoteServiceConfig(): { baseUrl: string; token: string } {
  const baseUrl = appConfig.remoteServiceUrl
  const token = appConfig.remoteServiceToken
  if (!baseUrl || !token) {
    throw new Error('缺少 REMOTE_SERVICE_URL 或 REMOTE_SERVICE_TOKEN')
  }
  return { baseUrl, token }
}
