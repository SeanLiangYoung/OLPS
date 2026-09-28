import 'vitest'

declare module 'vitest' {
  export interface ProvidedContext {
    remoteServiceUrl: string
    remoteServiceToken: string
  }
}
