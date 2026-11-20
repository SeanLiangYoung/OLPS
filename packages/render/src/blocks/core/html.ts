import type { RegisteredBlock } from '../types.js'

export const coreHtmlBlock: RegisteredBlock = {
  type: 'core/html',
  source: 'core',
  name: 'HTML',
  description: 'Raw HTML',
  category: 'content',
  fields: [
    {
      key: 'html',
      type: 'text',
      label: 'HTML',
      required: true,
      translatable: true,
    },
  ],
  accepts: [],
  preview: {
    html: '<p>HTML</p>',
  },
  template: `{{ block.props.html }}`,
}
