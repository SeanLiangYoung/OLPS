import type { EntityId, SchemaVersion } from './content.js'

export type PublishConnectors = {
  ga4?: {
    measurementId: string
  }
  googleAds?: {
    conversionId: string
    conversionLabel: string
  }
  meta?: {
    pixelId: string
  }
}

export type ConversionSettings = {
  submitInquiry: boolean
  qualifiedInquiry: boolean
}

export type PublishConfig = {
  schemaVersion: SchemaVersion
  siteId: EntityId
  publicSiteUrl: string
  publicApiBaseUrl: string
  hostingBasePath: string
  connectors: PublishConnectors
  conversionSettings: ConversionSettings
  indexNowKey: string
}
