import { expect,it } from 'vitest'
import { EditorHistory } from './history'

it('连续五十次修改可以完整撤销与重做，修改历史后清除后续步骤',()=>{
  const history=new EditorHistory({title:'Initial',blocks:[] as string[]})
  for(let index=1;index<=50;index++)history.apply({title:`Title ${index}`,blocks:[String(index)]})
  for(let index=49;index>=0;index--)expect(history.undo().title).toBe(index===0?'Initial':`Title ${index}`)
  expect(history.canUndo).toBe(false)
  for(let index=1;index<=50;index++)expect(history.redo().title).toBe(`Title ${index}`)
  const restored=history.undo()
  history.apply({...restored,title:'Edited'})
  expect(history.canRedo).toBe(false)
  restored.title='External mutation'
  expect(history.current.title).toBe('Edited')
})
