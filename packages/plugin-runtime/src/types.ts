export type PluginPermissions = {
  store?: boolean
  inquiries?: boolean
  fetch?: string[]
}

export type PluginStoreBinding = {
  get(key: string): Promise<unknown> | unknown
  set(key: string, value: unknown): Promise<void> | void
  delete(key: string): Promise<void> | void
}

export type PluginInquiriesBinding = {
  create(payload: Record<string, unknown>): Promise<unknown> | unknown
}

export type PluginLogBinding = (
  level: string,
  message: string,
  meta?: Record<string, unknown>,
) => void

export type PluginFetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export type PluginFetchResult = {
  status: number
  headers: Record<string, string>
  body: string
}

export type PluginFetchImpl = (
  url: string,
  init?: PluginFetchInit,
) => Promise<PluginFetchResult>

export type PluginOnBuildFile = {
  path: string
  content: string
}

export type PluginApiRequest = {
  method: string
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  body: unknown
}

export type PluginApiResponse = {
  status: number
  headers?: Record<string, string>
  body?: unknown
}

export type PluginRuntimeBindings = {
  settings: Record<string, unknown>
  site?: unknown
  store?: PluginStoreBinding
  inquiries?: PluginInquiriesBinding
  log: PluginLogBinding
  fetchImpl?: PluginFetchImpl
}
