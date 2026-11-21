import type { BlockNode,ManagedSeoFields } from '@olps/domain'
import type { ContentRef } from '@olps/domain'

export type EditorContent={ref:ContentRef['ref'];collectionId?:string;meta:Record<string,unknown>;locale:Record<string,unknown>&{locale:string;title:string;summary:string;seo:ManagedSeoFields;blocks:BlockNode[]}}
export type EditorDocument={content:EditorContent;revision:string}

export function findBlock(blocks:BlockNode[],id:string):BlockNode|undefined{
  for(const block of blocks){if(block.id===id)return block;const nested=findBlock(block.children,id);if(nested)return nested}
  return undefined
}

export function changeBlock(blocks:BlockNode[],id:string,change:(block:BlockNode)=>void):void{
  const block=findBlock(blocks,id)
  if(!block)throw new Error('选中的内容已不存在')
  change(block)
}

export function removeBlock(blocks:BlockNode[],id:string):boolean{
  const index=blocks.findIndex(block=>block.id===id)
  if(index>=0){blocks.splice(index,1);return true}
  return blocks.some(block=>removeBlock(block.children,id))
}

export function freshBlock(block:BlockNode):BlockNode{
  return {...block,id:crypto.randomUUID(),props:JSON.parse(JSON.stringify(block.props)),children:block.children.map(freshBlock)}
}
