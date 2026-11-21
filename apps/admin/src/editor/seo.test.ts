import { expect,it } from 'vitest'
import { inspectSeo } from './seo'

it('搜索检查覆盖主标题、标题层级、图片替代文字、重复标题和内容长度',()=>{
  const result=inspectSeo('<h1>One</h1><h1>Two</h1><h3>Jump</h3><img src="image.svg">','Repeated','Summary',['Repeated'])
  expect(result.some(message=>message.includes('一个主标题'))).toBe(true)
  expect(result.some(message=>message.includes('标题层级'))).toBe(true)
  expect(result.some(message=>message.includes('替代文字'))).toBe(true)
  expect(result.some(message=>message.includes('重复'))).toBe(true)
  expect(result.some(message=>message.includes('内容较少'))).toBe(true)
})
