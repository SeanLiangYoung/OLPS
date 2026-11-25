export type KnowledgeServiceConfig = {
  knowledgeRoot: string
  serviceToken: string
  importMaxBytes: number
  singleFileMaxBytes: number
  uploadChunkBytes: number
  databaseUrl?: string
  listenPort?: number
  listenHost?: string
}