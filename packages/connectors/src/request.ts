import type { Provider } from './config.js'

export class ConnectorRequestError extends Error {
  constructor(readonly provider: Provider, readonly operation: string, readonly status?: number, readonly providerCode?: string) { super(`${provider}连接器请求失败：${operation}`) }
}

export async function providerRequest<T>(provider: Provider, operation: string, action: () => Promise<T>): Promise<T> {
  try { return await action() }
  catch (error) {
    const detail = error as { code?: unknown; status?: unknown; response?: { status?: unknown; data?: { error?: string | { code?: unknown } } } }
    const status = typeof detail.response?.status === 'number' ? detail.response.status : typeof detail.status === 'number' ? detail.status : undefined
    const code = detail.response?.data?.error
    const rawCode = typeof code === 'string' ? code : code && typeof code === 'object' ? code.code : detail.code
    const safeCode = typeof rawCode === 'number' ? String(rawCode) : typeof rawCode === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,79}$/.test(rawCode) ? rawCode : undefined
    throw new ConnectorRequestError(provider, operation, status, safeCode)
  }
}
