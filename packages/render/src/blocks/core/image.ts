import type { RegisteredBlock } from '../types.js'

export const coreImageBlock: RegisteredBlock = {
  type: 'core/image',
  source: 'core',
  name: 'Image',
  description: 'Image block',
  category: 'media',
  fields: [
    {
      key: 'image',
      type: 'media',
      label: 'Image',
      required: true,
      translatable: false,
    },
    {
      key: 'alt',
      type: 'text',
      label: 'Alt',
      required: false,
      translatable: true,
      default: '',
    },
  ],
  accepts: [],
  preview: {
    image: { mediaId: '00000000-0000-4000-8000-000000000001' },
    alt: 'Image',
  },
  template: `<figure class="olps-image"><img src="{{ block.props.src }}" alt="{{ block.props.alt }}" loading="lazy" /></figure>`,
}
