import type { RegisteredBlock } from '../types.js'

export const coreButtonBlock: RegisteredBlock = {
  type: 'core/button',
  source: 'core',
  name: 'Button',
  description: 'Call to action button',
  category: 'content',
  fields: [
    {
      key: 'label',
      type: 'text',
      label: 'Label',
      required: true,
      translatable: true,
    },
    {
      key: 'link',
      type: 'link',
      label: 'Link',
      required: true,
      translatable: false,
    },
  ],
  accepts: [],
  preview: {
    label: 'Learn more',
    link: {
      kind: 'external',
      url: 'https://example.com',
      newWindow: false,
    },
  },
  template: `<a class="olps-button" href="{{ block.props.href }}"{% if block.props.newWindow %} target="_blank" rel="noopener noreferrer"{% endif %}>{{ block.props.label }}</a>`,
}
