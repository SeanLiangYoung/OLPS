import type { RegisteredBlock } from '../types.js'

export const coreTextBlock: RegisteredBlock = {
  type: 'core/text',
  source: 'core',
  name: 'Text',
  description: 'Rich text paragraph',
  category: 'content',
  fields: [
    {
      key: 'content',
      type: 'richtext',
      label: 'Content',
      required: true,
      translatable: true,
    },
  ],
  accepts: [],
  preview: {
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Text' }],
        },
      ],
    },
  },
  template: `<div class="olps-text">{{ block.props.renderedContent }}</div>`,
}
