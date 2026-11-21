import { expect,it } from 'vitest'
import { inspectSeo } from './seo-checklist.js'

it('共享SEO检查覆盖标题、摘要、主标题、层级、图片、重复和正文长度',()=>{
  const html='<html><body><h1>First</h1><h3>Skipped</h3><h1>Second</h1><img src="image.png"></body></html>'
  const issues=inspectSeo(html,'重复标题','', ['重复标题'])
  for(const text of ['搜索结果摘要','主标题','标题层级','图片','重复','正文内容'])expect(issues.some(issue=>issue.includes(text))).toBe(true)
  expect(inspectSeo(`<html><body><h1>Title</h1><h2>Details</h2><p>${'Content '.repeat(40)}</p><img src="image.png" alt="说明"></body></html>`,'Unique title','Useful description',[])).toEqual([])
  expect(inspectSeo(html,'a'.repeat(61),'b'.repeat(161),[])).toEqual(expect.arrayContaining([expect.stringContaining('60'),expect.stringContaining('160')]))
})
