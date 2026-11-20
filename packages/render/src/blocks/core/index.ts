import type { RegisteredBlock } from '../types.js'
import { coreButtonBlock } from './button.js'
import { coreCollectionListBlock } from './collection-list.js'
import { coreColumnsBlock } from './columns.js'
import { coreFaqBlock } from './faq.js'
import { coreHeadingBlock } from './heading.js'
import { coreHtmlBlock } from './html.js'
import { coreImageBlock } from './image.js'
import { coreTextBlock } from './text.js'

export const coreBlocks: RegisteredBlock[] = [
  coreTextBlock,
  coreHeadingBlock,
  coreImageBlock,
  coreButtonBlock,
  coreColumnsBlock,
  coreCollectionListBlock,
  coreFaqBlock,
  coreHtmlBlock,
]

export {
  coreButtonBlock,
  coreCollectionListBlock,
  coreColumnsBlock,
  coreFaqBlock,
  coreHeadingBlock,
  coreHtmlBlock,
  coreImageBlock,
  coreTextBlock,
}
