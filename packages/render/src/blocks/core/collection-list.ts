import type { RegisteredBlock } from '../types.js'

export const coreCollectionListBlock: RegisteredBlock = {
  type: 'core/collection-list',
  source: 'core',
  name: 'Collection List',
  description: 'List of groups or items',
  category: 'collection',
  fields: [
    {
      key: 'collectionId',
      type: 'text',
      label: 'Collection ID',
      required: true,
      translatable: false,
    },
    {
      key: 'pageSize',
      type: 'number',
      label: 'Page size',
      required: true,
      translatable: false,
      default: 10,
    },
    {
      key: 'sort',
      type: 'select',
      label: 'Sort',
      required: true,
      translatable: false,
      options: [
        { value: 'manual', label: 'Manual' },
        { value: 'publishedAt', label: 'Published at' },
        { value: 'title', label: 'Title' },
      ],
      default: 'manual',
    },
  ],
  accepts: [],
  preview: {
    collectionId: '00000000-0000-4000-8000-000000000002',
    pageSize: 10,
    sort: 'manual',
  },
  template: `<ul class="olps-collection-list">{% for item in block.props.items %}<li><a href="{{ item.url }}">{{ item.title }}</a></li>{% endfor %}</ul>`,
}
