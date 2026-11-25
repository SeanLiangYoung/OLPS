export type KnowledgeServiceConfig = {
  knowledgeRoot: string
  serviceToken: string
  importMaxBytes: number
  singleFileMaxBytes: number
  listenPort?: number
  listenHost?: string
}