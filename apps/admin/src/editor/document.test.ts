import { expect,it } from 'vitest'
import { changeBlock,findBlock,freshBlock,removeBlock } from './document'

it('嵌套区块修改、复制和删除保持其他内容',()=>{
  const blocks=[{id:'parent',type:'core/columns',props:{columns:2},children:[{id:'heading',type:'core/heading',props:{text:'Heading',level:2},children:[]}]}]
  changeBlock(blocks,'heading',block=>{block.props.text='Updated'})
  const copy=freshBlock(blocks[0])
  expect(copy.id).not.toBe('parent')
  expect(copy.children[0].id).not.toBe('heading')
  expect(copy.children[0].props.text).toBe('Updated')
  expect(removeBlock(blocks,'heading')).toBe(true)
  expect(findBlock(blocks,'parent')!.props.columns).toBe(2)
  expect(findBlock(blocks,'heading')).toBeUndefined()
})
