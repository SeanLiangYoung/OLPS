import type { RegisteredBlock } from '../types.js'

export const coreColumnsBlock: RegisteredBlock = {
  type: 'core/columns',
  source: 'core',
  name: 'Columns',
  description: 'Multi-column layout',
  category: 'layout',
  fields: [
    {
      key: 'columns',
      type: 'number',
      label: 'Columns',
      required: true,
      translatable: false,
      default: 2,
    },
  ],
  accepts: [
    'core/text',
    'core/heading',
    'core/image',
    'core/button',
    'core/html',
    'core/faq',
  ],
  preview: {
    columns: 2,
  },
  template: `<div class="olps-columns" data-columns="{{ block.props.columns }}">{{ block.children }}</div>`,
}
