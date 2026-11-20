import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv'
import appearanceSchema from './schemas/appearance.schema.json' with { type: 'json' }
import collectionIndexLocaleSchema from './schemas/collection-index-locale.schema.json' with { type: 'json' }
import collectionSchema from './schemas/collection.schema.json' with { type: 'json' }
import groupLocaleSchema from './schemas/group-locale.schema.json' with { type: 'json' }
import groupMetaSchema from './schemas/group-meta.schema.json' with { type: 'json' }
import i18nSchema from './schemas/i18n.schema.json' with { type: 'json' }
import itemLocaleSchema from './schemas/item-locale.schema.json' with { type: 'json' }
import itemMetaSchema from './schemas/item-meta.schema.json' with { type: 'json' }
import manifestSchema from './schemas/manifest.schema.json' with { type: 'json' }
import mediaSchema from './schemas/media.schema.json' with { type: 'json' }
import pageLocaleSchema from './schemas/page-locale.schema.json' with { type: 'json' }
import pageMetaSchema from './schemas/page-meta.schema.json' with { type: 'json' }
import pluginSchema from './schemas/plugin.schema.json' with { type: 'json' }
import pluginsSchema from './schemas/plugins.schema.json' with { type: 'json' }
import publishConfigSchema from './schemas/publish-config.schema.json' with { type: 'json' }
import redirectsSchema from './schemas/redirects.schema.json' with { type: 'json' }
import sectionSchema from './schemas/section.schema.json' with { type: 'json' }
import siteSettingsSchema from './schemas/site-settings.schema.json' with { type: 'json' }
import themeSchema from './schemas/theme.schema.json' with { type: 'json' }
import type { PageRole } from './content.js'

export const schemaNames = [
  'site-settings',
  'publish-config',
  'appearance',
  'plugins',
  'redirects',
  'page-meta',
  'page-locale',
  'collection',
  'collection-index-locale',
  'group-meta',
  'group-locale',
  'item-meta',
  'item-locale',
  'media',
  'i18n',
  'theme',
  'plugin',
  'section',
  'manifest',
] as const

export type SchemaName = (typeof schemaNames)[number]

export type ValidationErrorDetail = {
  objectPath: string
  schemaPath: string
  message: string
}

export type ValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: ValidationErrorDetail[] }

export type ValidationContext = {
  pageRole?: PageRole | null
}

const schemas: Record<SchemaName, object> = {
  'site-settings': siteSettingsSchema,
  'publish-config': publishConfigSchema,
  appearance: appearanceSchema,
  plugins: pluginsSchema,
  redirects: redirectsSchema,
  'page-meta': pageMetaSchema,
  'page-locale': pageLocaleSchema,
  collection: collectionSchema,
  'collection-index-locale': collectionIndexLocaleSchema,
  'group-meta': groupMetaSchema,
  'group-locale': groupLocaleSchema,
  'item-meta': itemMetaSchema,
  'item-locale': itemLocaleSchema,
  media: mediaSchema,
  i18n: i18nSchema,
  theme: themeSchema,
  plugin: pluginSchema,
  section: sectionSchema,
  manifest: manifestSchema,
}

const ajv = new Ajv({ allErrors: true, strict: true })
const validators = new Map<SchemaName, ValidateFunction>(
  schemaNames.map((schemaName) => [schemaName, ajv.compile(schemas[schemaName])]),
)

function formatAjvError(error: ErrorObject): ValidationErrorDetail {
  const missingProperty = error.keyword === 'required'
    ? `/${String(error.params.missingProperty)}`
    : ''
  const additionalProperty = error.keyword === 'additionalProperties'
    ? `/${String(error.params.additionalProperty)}`
    : ''

  return {
    objectPath: `${error.instancePath}${missingProperty}${additionalProperty}` || '/',
    schemaPath: error.schemaPath,
    message: error.message ?? 'JSON Schema validation failed',
  }
}

function crossFieldErrors(
  schemaName: SchemaName,
  value: unknown,
  context: ValidationContext,
): ValidationErrorDetail[] {
  if (typeof value !== 'object' || value === null) {
    return []
  }

  const document = value as Record<string, unknown>
  const errors: ValidationErrorDetail[] = []

  if (schemaName === 'site-settings') {
    const defaultLocale = document.defaultLocale
    const locales = document.locales
    if (
      typeof defaultLocale === 'string'
      && Array.isArray(locales)
      && !locales.some((locale) => (
        typeof locale === 'object'
        && locale !== null
        && (locale as Record<string, unknown>).code === defaultLocale
      ))
    ) {
      errors.push({
        objectPath: '/defaultLocale',
        schemaPath: '#/crossField/defaultLocale',
        message: 'must identify an entry in locales',
      })
    }
  }

  if (
    schemaName === 'page-locale'
    && (context.pageRole === 'home' || context.pageRole === 'not-found')
    && document.slug !== ''
  ) {
    errors.push({
      objectPath: '/slug',
      schemaPath: '#/crossField/pageRoleSlug',
      message: `must be empty when pageRole is ${context.pageRole}`,
    })
  }

  if (schemaName === 'item-meta') {
    const primaryGroupId = document.primaryGroupId
    const groupIds = document.groupIds
    if (primaryGroupId === null && Array.isArray(groupIds) && groupIds.length > 0) {
      errors.push({
        objectPath: '/groupIds',
        schemaPath: '#/crossField/ungroupedItem',
        message: 'must be empty when primaryGroupId is null',
      })
    }
    if (
      typeof primaryGroupId === 'string'
      && Array.isArray(groupIds)
      && !groupIds.includes(primaryGroupId)
    ) {
      errors.push({
        objectPath: '/primaryGroupId',
        schemaPath: '#/crossField/primaryGroupId',
        message: 'must identify an entry in groupIds',
      })
    }
  }

  return errors
}

export function validateSchema(
  schemaName: SchemaName,
  value: unknown,
  context: ValidationContext = {},
): ValidationResult {
  const validator = validators.get(schemaName)
  if (validator === undefined) {
    throw new TypeError(`Unknown schema: ${schemaName}`)
  }

  const valid = validator(value)
  const errors = [
    ...(valid ? [] : (validator.errors ?? []).map(formatAjvError)),
    ...crossFieldErrors(schemaName, value, context),
  ]

  return errors.length === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors }
}

export class SchemaValidationError extends Error {
  readonly schemaName: SchemaName
  readonly filePath: string | undefined
  readonly errors: ValidationErrorDetail[]

  constructor(
    schemaName: SchemaName,
    errors: ValidationErrorDetail[],
    filePath?: string,
  ) {
    const location = filePath === undefined ? schemaName : filePath
    super(`${location}: ${errors.map((error) => `${error.objectPath} ${error.message}`).join('; ')}`)
    this.name = 'SchemaValidationError'
    this.schemaName = schemaName
    this.filePath = filePath
    this.errors = errors
  }
}

export function assertValidSchema(
  schemaName: SchemaName,
  value: unknown,
  filePath?: string,
  context: ValidationContext = {},
): asserts value is Record<string, unknown> {
  const result = validateSchema(schemaName, value, context)
  if (!result.valid) {
    throw new SchemaValidationError(schemaName, result.errors, filePath)
  }
}
