import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv'
import type { BlockFieldDefinition } from '@olps/domain'

const ajv = new Ajv({
  allErrors: true,
  strict: false,
})

const validators = new Map<string, ValidateFunction>()

function fieldSchema(field: BlockFieldDefinition): object {
  switch (field.type) {
    case 'text':
    case 'color':
      return { type: 'string' }
    case 'richtext':
      return { type: 'object' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'media':
      return {
        type: 'object',
        additionalProperties: false,
        required: ['mediaId'],
        properties: {
          mediaId: { type: 'string', minLength: 1 },
        },
      }
    case 'mediaList':
      return {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['mediaId'],
          properties: {
            mediaId: { type: 'string', minLength: 1 },
          },
        },
      }
    case 'link':
      return {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'target'],
            properties: {
              kind: { const: 'internal' },
              target: {
                type: 'object',
                additionalProperties: false,
                required: ['ref', 'id'],
                properties: {
                  ref: { enum: ['page', 'collection', 'group', 'item'] },
                  id: { type: 'string', minLength: 1 },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'url', 'newWindow'],
            properties: {
              kind: { const: 'external' },
              url: { type: 'string', minLength: 1 },
              newWindow: { type: 'boolean' },
            },
          },
        ],
      }
    case 'select':
      return {
        type: 'string',
        enum: (field.options ?? []).map((option) => option.value),
      }
    case 'list':
      return {
        type: 'array',
        items: propsSchemaFromFields(field.itemFields ?? []),
      }
    default: {
      const exhaustive: never = field.type
      throw new Error(`未知字段类型：${exhaustive}`)
    }
  }
}

export function propsSchemaFromFields(fields: BlockFieldDefinition[]): object {
  const properties: Record<string, object> = {}
  const required: string[] = []
  for (const field of fields) {
    properties[field.key] = fieldSchema(field)
    if (field.required) {
      required.push(field.key)
    }
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  }
}

export function validateBlockProps(
  blockType: string,
  fields: BlockFieldDefinition[],
  props: Record<string, unknown>,
): ErrorObject[] {
  let validator = validators.get(blockType)
  if (!validator) {
    validator = ajv.compile(propsSchemaFromFields(fields))
    validators.set(blockType, validator)
  }
  const valid = validator(props)
  if (valid) {
    return []
  }
  return validator.errors ?? []
}
