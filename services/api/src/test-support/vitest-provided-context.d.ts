import 'vitest'

declare module 'vitest' {
  export interface ProvidedContext {
    remoteServiceUrl: string
    remoteServiceToken: string
    remoteDataRoot: string
    knowledgeServiceUrl: string
    knowledgeServiceToken: string
    knowledgeDataRoot: string
  }
}
