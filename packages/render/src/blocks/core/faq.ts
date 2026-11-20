import type { RegisteredBlock } from '../types.js'

export const coreFaqBlock: RegisteredBlock = {
  type: 'core/faq',
  source: 'core',
  name: 'FAQ',
  description: 'Frequently asked questions',
  category: 'content',
  fields: [
    {
      key: 'items',
      type: 'list',
      label: 'Items',
      required: true,
      translatable: true,
      itemFields: [
        {
          key: 'question',
          type: 'text',
          label: 'Question',
          required: true,
          translatable: true,
        },
        {
          key: 'answer',
          type: 'text',
          label: 'Answer',
          required: true,
          translatable: true,
        },
      ],
    },
  ],
  accepts: [],
  preview: {
    items: [{ question: 'Question', answer: 'Answer' }],
  },
  template: `<div class="olps-faq">{% for item in block.props.items %}<details><summary>{{ item.question }}</summary><div>{{ item.answer }}</div></details>{% endfor %}</div>`,
}
