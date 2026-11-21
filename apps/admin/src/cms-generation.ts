export type GenerationNode={nodeId:string;ref:'page'|'collection'|'group'|'item';collectionId?:string;title:string;requirements:string;meta?:Record<string,unknown>;children?:GenerationNode[]}
export const generationLabels={propose_site_structure:'规划网站结构',generate_nodes:'生成所选内容',generate_node:'新建一项内容',revise_node:'修改已有内容',rewrite_block:'改写内容区域',generate_legal_pages:'生成法律说明页面',translate_node:'翻译一项内容',translate_site:'翻译整个网站',translate_strings:'翻译网站固定文字',generate_seo:'生成搜索引擎信息'}
export type GenerationType=keyof typeof generationLabels
