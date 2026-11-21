import { z } from 'zod'
import { assertValidSchema, type BlockNode } from '@olps/domain'
import { loadBlockRegistry, validateBlockProps } from '@olps/render'
import type { ManagedContent } from '../content-sandbox.js'
import { ContentError } from '../content-sandbox.js'
import type { SourceReader } from '@olps/render'

export const jobTypes=['propose_site_structure','generate_nodes','generate_node','revise_node','rewrite_block','generate_legal_pages','translate_node','translate_site','translate_strings','generate_seo'] as const
export type CmsJobType=typeof jobTypes[number]
const ref=z.enum(['page','collection','group','item'])
export type GenerationNodeRequest={nodeId:string;ref:ContentKind;collectionId?:string;title:string;requirements:string;meta?:Record<string,unknown>;children?:GenerationNodeRequest[]}
import type { ContentKind } from '../content-sandbox.js'
export const nodeRequestSchema:z.ZodType<GenerationNodeRequest>=z.lazy(()=>z.object({nodeId:z.string().uuid(),ref,collectionId:z.string().optional(),title:z.string(),requirements:z.string().default(''),meta:z.record(z.string(),z.unknown()).optional(),children:z.array(nodeRequestSchema).optional()}).strict())
export const jobRequestSchema=z.object({draftId:z.string(),locale:z.string(),instruction:z.string().optional(),title:z.string().optional(),ref:ref.optional(),collectionId:z.string().optional(),knowledgeDocumentIds:z.array(z.string()).optional(),target:z.object({ref,id:z.string()}).strict().optional(),node:nodeRequestSchema.optional(),nodes:z.array(nodeRequestSchema).optional(),blockId:z.string().optional(),targetLocale:z.string().optional(),scope:z.enum(['all','outdated']).optional()}).strict()
export type CmsJobRequest=z.infer<typeof jobRequestSchema>

export async function validateGeneratedContent(content:ManagedContent,reader:SourceReader,themeId:string,enabledPluginIds:string[]):Promise<void>{
  const metaSchema=content.ref==='collection'?'collection':`${content.ref}-meta`
  const localeSchema=content.ref==='collection'?'collection-index-locale':`${content.ref}-locale`
  assertValidSchema(metaSchema as Parameters<typeof assertValidSchema>[0],content.meta,'AI.content.meta')
  assertValidSchema(localeSchema as Parameters<typeof assertValidSchema>[0],content.locale,'AI.content.locale',content.ref==='page'?{pageRole:content.meta.role as never}:undefined)
  const seo=content.locale.seo as {title:string;description:string}
  if(seo.title.length>60||seo.description.length>160)throw new ContentError('VALIDATION_FAILED',{field:'seo'})
  const registry=await loadBlockRegistry(reader,{themeId,enabledPluginIds})
  const ids=new Set<string>()
  const walk=(nodes:BlockNode[]):void=>{
    for(const block of nodes){
      const definition=registry.get(block.type)
      if(!definition)throw new ContentError('VALIDATION_FAILED',{blockType:block.type})
      if(ids.has(block.id))throw new ContentError('VALIDATION_FAILED',{blockId:block.id})
      ids.add(block.id)
      if(block.children.some(child=>!definition.accepts.includes(child.type)))throw new ContentError('VALIDATION_FAILED',{blockId:block.id,field:'children'})
      const errors=validateBlockProps(block.type,definition.fields,block.props)
      if(errors.length)throw new ContentError('VALIDATION_FAILED',{blockId:block.id,issues:errors})
      walk(block.children)
    }
  }
  walk(content.locale.blocks as BlockNode[])
}
