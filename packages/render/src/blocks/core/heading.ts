import type { RegisteredBlock } from '../types.js'

export const coreHeadingBlock: RegisteredBlock = {
  type: 'core/heading',
  source: 'core',
  name: 'Heading',
  description: 'Heading text',
  category: 'content',
  fields: [
    {
      key: 'text',
      type: 'text',
      label: 'Text',
      required: true,
      translatable: true,
    },
    {
      key: 'level',
      type: 'number',
      label: 'Level',
      required: true,
      translatable: false,
      default: 2,
    },
  ],
  accepts: [],
  preview: {
    text: 'Heading',
    level: 2,
  },
  template: `<h{{ block.props.level }} class="olps-heading">{{ block.props.text }}</h{{ block.props.level }}>`,
}
